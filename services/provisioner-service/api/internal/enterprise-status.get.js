// GET /api/internal/enterprise-status?tenantId=&action=apply|destroy — live status of
// an enterprise tenant's Terraform Job. Internal only (network-policy + x-internal-token
// gated); polled by the user-service admin status endpoint. Returns the Job phase plus
// the Terraform outputs (ingress_ip, system_hostname, cluster_name) once available.
import { enterpriseStatus } from '../../utils/enterprise.js'

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const tenantId = String(q.tenantId || '')
  const action = q.action === 'destroy' ? 'destroy' : 'apply'
  if (!tenantId || tenantId === 'default' || !ID_RE.test(tenantId)) {
    throw createError({ statusCode: 400, statusMessage: 'valid tenantId required' })
  }
  try {
    return { ok: true, action, ...(await enterpriseStatus(tenantId, action)) }
  } catch (e) {
    console.error('[provisioner] enterprise-status failed', e)
    throw createError({ statusCode: 500, statusMessage: `status check failed: ${e?.message || e}` })
  }
})
