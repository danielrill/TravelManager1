// GET /api/admin/tenants/:id — provisioning status for the operator console. The
// admin host (admin.onecloudaway.de) only proxies /api/admin/* through the gateway,
// so the SPA's New-Tenant page polls THIS route (not /api/tenants/:id/status, which
// the gateway 404s on the admin host) to watch a freshly-created tenant flip live.
//
// Standard tenants flip when their pods are ready (provisioned_at, set by the create
// flow). Enterprise tenants are built by a long Terraform Job on a dedicated cluster:
// we reconcile their status from the provisioner's live view of that Job on each poll,
// persisting the Terraform outputs (ingress IP, system hostname) and marking the
// tenant live the first time the Job reports success.
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'
import { requireAdmin } from '../../../utils/admin.js'
import { markProvisioned, setTenantClusterInfo, upsertProvisioningJob } from '../../../utils/tenants.js'
import { traceHeaders } from '@travelmanager/shared/trace'

function provHeaders(event) {
  return { ...traceHeaders(event), 'x-internal-token': process.env.PROVISIONER_INTERNAL_TOKEN || '' }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const db = getDb()
  const { rows } = await db.query(
    'SELECT plan, provisioned_at, ingress_ip, system_hostname, cluster_name, tls_status FROM tenants WHERE id = $1',
    [id]
  )
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  const t = rows[0]
  const provUrl = process.env.PROVISIONER_SERVICE_URL || 'http://localhost:3006'

  // Enterprise teardown in flight: reconcile the destroy Job. When it completes we
  // finalize offboarding (remove the tenant + job rows) so the cluster's cloud
  // resources don't leak with no UI handle. A failed destroy stays visible to retry.
  if (t.tls_status === 'destroying') {
    let s
    try {
      s = await $fetch('/api/internal/enterprise-status', {
        baseURL: provUrl, params: { tenantId: id, action: 'destroy' }, headers: provHeaders(event),
      })
    } catch (e) {
      console.error(`[user-service] enterprise destroy poll failed for ${id}:`, e?.data?.statusMessage || e?.message || e)
      return { id, plan: 'enterprise', status: 'destroying', phase: 'unknown' }
    }
    if (s?.phase === 'live') {
      await db.query('DELETE FROM provisioning_jobs WHERE tenant_id = $1', [id])
      await db.query('DELETE FROM tenants WHERE id = $1', [id])
      invalidate(`tenant:${id}`)
      return { id, status: 'deleted' }
    }
    if (s?.phase === 'failed') {
      await upsertProvisioningJob(id, 'destroy', { status: 'failed', error: s.error || 'terraform destroy failed' }).catch(() => {})
      return { id, plan: 'enterprise', status: 'destroying', phase: 'failed', error: s.error || 'teardown failed' }
    }
    return { id, plan: 'enterprise', status: 'destroying', phase: s?.phase || 'running' }
  }

  // Non-enterprise: simple provisioned_at gate (unchanged behaviour).
  if (t.plan !== 'enterprise') {
    return { id, plan: t.plan, status: t.provisioned_at ? 'live' : 'provisioning' }
  }

  // Enterprise: already live — return persisted cluster info without re-polling.
  if (t.provisioned_at) {
    return {
      id, plan: 'enterprise', status: 'live',
      ingress_ip: t.ingress_ip, system_hostname: t.system_hostname, cluster_name: t.cluster_name,
    }
  }

  // Reconcile from the provisioner's live view of the Terraform apply Job.
  let s
  try {
    s = await $fetch('/api/internal/enterprise-status', {
      baseURL: provUrl,
      params: { tenantId: id, action: 'apply' },
      headers: provHeaders(event),
    })
  } catch (e) {
    // Transient — report still provisioning; the SPA keeps polling.
    console.error(`[user-service] enterprise status poll failed for ${id}:`, e?.data?.statusMessage || e?.message || e)
    return { id, plan: 'enterprise', status: 'provisioning', phase: 'unknown' }
  }

  const phase = s?.phase || 'unknown'
  if (phase === 'live') {
    await setTenantClusterInfo(id, {
      cluster_name: s.cluster_name, ingress_ip: s.ingress_ip, system_hostname: s.system_hostname,
    })
    await markProvisioned(id)
    await upsertProvisioningJob(id, 'create', {
      status: 'live', cluster_name: s.cluster_name, ingress_ip: s.ingress_ip, system_hostname: s.system_hostname,
    }).catch(() => {})
    return {
      id, plan: 'enterprise', status: 'live',
      ingress_ip: s.ingress_ip, system_hostname: s.system_hostname, cluster_name: s.cluster_name,
    }
  }

  if (phase === 'failed') {
    await upsertProvisioningJob(id, 'create', { status: 'failed', error: s.error || 'terraform failed' }).catch(() => {})
    return { id, plan: 'enterprise', status: 'failed', phase, error: s.error || 'provisioning failed' }
  }

  return { id, plan: 'enterprise', status: 'provisioning', phase }
})
