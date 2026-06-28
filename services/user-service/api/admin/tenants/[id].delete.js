// DELETE /api/admin/tenants/:id — offboard a tenant.
//
// Standard: tear down its Postgres pod + PVC (via the provisioner), move members
// back to the free 'default' tenant, and remove the tenant row — synchronously.
//
// Enterprise: destroying a dedicated GKE cluster + Cloud SQL takes 10+ min, so we
// fire a Terraform destroy Job, mark the tenant 'destroying', move members back to
// free, and return 202. The admin status poll (GET /api/admin/tenants/:id) reconciles
// the destroy Job and finalizes removal once it completes — keeping the row (and its
// cluster handle) until then so the cloud resources can't silently leak.
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'
import { requireAdmin } from '../../../utils/admin.js'
import { upsertProvisioningJob } from '../../../utils/tenants.js'
import { traceHeaders } from '@travelmanager/shared/trace'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (id === 'default') {
    throw createError({ statusCode: 400, statusMessage: 'The free tenant cannot be deleted' })
  }

  const db = getDb()
  const { rows } = await db.query('SELECT id, plan, subdomain, provisioned_at, cluster_name FROM tenants WHERE id = $1', [id])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  const { plan, subdomain: sub, provisioned_at, cluster_name } = rows[0]

  const provUrl = process.env.PROVISIONER_SERVICE_URL || 'http://localhost:3006'
  const headers = { ...traceHeaders(event), 'x-internal-token': process.env.PROVISIONER_INTERNAL_TOKEN || '' }

  // ── Enterprise that NEVER built (failed/aborted apply: no cluster) ──
  // Nothing exists in GCP to tear down, so don't spawn a destroy Job (it would just
  // sit at "destroying…" and the list never finalizes it). Remove the rows directly.
  if (plan === 'enterprise' && !provisioned_at && !cluster_name) {
    await db.query('DELETE FROM provisioning_jobs WHERE tenant_id = $1', [id])
    await db.query(`UPDATE users SET tenant_id = 'default' WHERE tenant_id = $1`, [id])
    await db.query('DELETE FROM tenants WHERE id = $1', [id])
    invalidate(`tenant:${id}`)
    return { ok: true, deleted: id }
  }

  // ── Enterprise: async destroy of the dedicated cluster ──
  if (plan === 'enterprise') {
    let res
    try {
      res = await $fetch('/api/internal/deprovision-tenant', {
        method: 'POST', baseURL: provUrl, headers, body: { tenantId: id, plan },
      })
    } catch (e) {
      throw createError({ statusCode: 502, statusMessage: `Cluster teardown failed to start: ${e?.data?.statusMessage || e?.message || e}` })
    }
    await upsertProvisioningJob(id, 'destroy', { status: 'running', job_name: res?.job || null })
    // Mark destroying (so the status poll reconciles the destroy Job) and unorphan members.
    await db.query(`UPDATE tenants SET tls_status = 'destroying' WHERE id = $1`, [id])
    await db.query(`UPDATE users SET tenant_id = 'default' WHERE tenant_id = $1`, [id])
    invalidate(`tenant:${id}`)
    setResponseStatus(event, 202)
    return { ok: true, status: 'destroying', id }
  }

  // ── Standard: synchronous pod teardown ──
  // 1. Tear down the dedicated Postgres pod + PVC + Service + NetworkPolicy.
  try {
    await $fetch('/api/internal/deprovision-tenant', { method: 'POST', baseURL: provUrl, headers, body: { tenantId: id } })
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `Pod teardown failed: ${e?.data?.statusMessage || e?.message || e}` })
  }

  // 2. Move members back to the free tenant so they aren't orphaned.
  await db.query(`UPDATE users SET tenant_id = 'default' WHERE tenant_id = $1`, [id])

  // 3. Remove the tenant row + bust the gateway's host→tenant cache.
  await db.query('DELETE FROM tenants WHERE id = $1', [id])
  invalidate(`tenant:${id}`)
  if (sub) invalidate(`tenanthost:${sub}`)

  return { ok: true, deleted: id }
})
