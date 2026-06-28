// POST /api/internal/provision-tenant { tenantId, plan } — create a paid tenant's
// dedicated Postgres pod, databases and schemas. Internal only (network-policy +
// x-internal-token gated); called by the user-service onboarding flows. Idempotent
// — safe to retry on failure.
import { provisionTenant } from '../../utils/provision.js'
import { applyEnterprise } from '../../utils/enterprise.js'

// Tiers that get dedicated infrastructure. `free` shares the control-plane DB and
// must NEVER be provisioned here — gate it at the boundary so even an authenticated
// caller can't waste a Postgres pod + NEGs on a free tenant (defence in depth on
// top of the user-service plan check).
const PAID_PLANS = new Set(['standard', 'enterprise'])

export default defineEventHandler(async (event) => {
  const { tenantId, plan } = await readBody(event)
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenantId required' })
  if (!PAID_PLANS.has(plan)) {
    throw createError({ statusCode: 400, statusMessage: `plan must be one of ${[...PAID_PLANS].join(', ')} (got ${plan ?? 'none'})` })
  }

  // Enterprise: a DEDICATED GKE cluster + Cloud SQL, built by a Terraform Job. This
  // is a different code path from the standard pod model (provisionTenant) — it must
  // NEVER spin up Postgres/app pods on the shared cluster. Fire the Job and return
  // immediately; the caller polls /api/internal/enterprise-status (cluster create is
  // ~10-15 min, far longer than any HTTP request can hold).
  if (plan === 'enterprise') {
    try {
      const res = await applyEnterprise(String(tenantId))
      setResponseStatus(event, 202)
      return { ok: true, enterprise: true, status: 'provisioning', ...res }
    } catch (e) {
      console.error('[provisioner] enterprise apply failed to start', e)
      throw createError({ statusCode: 500, statusMessage: `Enterprise provisioning failed: ${e?.message || e}` })
    }
  }

  try {
    const report = await provisionTenant(String(tenantId))
    return { ok: true, ...report }
  } catch (e) {
    console.error('[provisioner] provision-tenant failed', e)
    const msg = String(e?.message || e)
    // Capacity preflight failures are retryable (no objects created) — surface as
    // 503 so callers can distinguish "try later" from a hard provisioning error.
    if (msg.startsWith('capacity:')) {
      throw createError({ statusCode: 503, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: `Provisioning failed: ${msg}` })
  }
})
