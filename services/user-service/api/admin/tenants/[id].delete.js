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
import { upsertProvisioningJob, getProvisioningJob } from '../../../utils/tenants.js'
import { traceHeaders } from '@travelmanager/shared/trace'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (id === 'default') {
    throw createError({ statusCode: 400, statusMessage: 'The free tenant cannot be deleted' })
  }

  const db = getDb()
  const { rows } = await db.query('SELECT id, plan, subdomain, provisioned_at, cluster_name, tls_status FROM tenants WHERE id = $1', [id])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  const { plan, subdomain: sub, provisioned_at, cluster_name, tls_status } = rows[0]

  const provUrl = process.env.PROVISIONER_SERVICE_URL || 'http://localhost:3006'
  const headers = { ...traceHeaders(event), 'x-internal-token': process.env.PROVISIONER_INTERNAL_TOKEN || '' }

  // ── Enterprise where the provisioner NEVER ran (no create Job → no terraform
  // state → no GCP infra) ──
  // Only then is it safe to drop the rows directly. CAUTION: a create Job that ran but
  // failed mid-apply (e.g. cluster built, helm step failed) leaves REAL infra with the
  // tenant row still un-provisioned — that MUST go through the destroy Job below, or the
  // cluster/SQL orphan in GCP. So gate on the absence of a create job, not provisioned_at.
  if (plan === 'enterprise' && !provisioned_at && !cluster_name) {
    const createdJob = await getProvisioningJob(id, 'create')
    if (!createdJob) {
      await db.query('DELETE FROM provisioning_jobs WHERE tenant_id = $1', [id])
      await db.query(`UPDATE users SET tenant_id = 'default' WHERE tenant_id = $1`, [id])
      await db.query('DELETE FROM tenants WHERE id = $1', [id])
      invalidate(`tenant:${id}`)
      return { ok: true, deleted: id }
    }
    // else fall through → destroy Job (terraform destroy cleans the partial infra).
  }

  // ── Enterprise re-delete: operator forcing a stuck teardown out of the list ──
  // The first delete set tls_status='destroying' and fired the destroy Job; the status
  // poll (GET :id) normally finalizes removal once that Job reports done. If the operator
  // clicks delete AGAIN, the row is stuck — the provisioner is unreachable, or the Job
  // was GC'd before any poll caught its success. Re-check the destroy status; if it's
  // done (or the provisioner can't be reached) hard-remove the rows. Terraform state
  // lives in GCS per-tenant, so dropping the DB handle never interrupts an in-flight
  // destroy — it only clears the UI. A teardown still reporting 'failed' is left in place
  // so real, half-torn-down infra can't silently orphan with no handle to retry.
  if (plan === 'enterprise' && tls_status === 'destroying') {
    let phase = null
    try {
      const s = await $fetch('/api/internal/enterprise-status', {
        baseURL: provUrl, params: { tenantId: id, action: 'destroy' }, headers,
      })
      phase = s?.phase || null
    } catch {
      phase = null // provisioner unreachable → operator override proceeds anyway
    }
    if (phase === 'failed') {
      throw createError({ statusCode: 409, statusMessage: 'Teardown failed — retry the destroy before removing (cluster/SQL may still exist)' })
    }
    await db.query('DELETE FROM provisioning_jobs WHERE tenant_id = $1', [id])
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
