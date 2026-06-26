// POST /api/internal/provision-tenant { tenantId, plan } — create a paid tenant's
// dedicated Postgres pod, databases and schemas. Internal only (network-policy +
// x-internal-token gated); called by the user-service onboarding flows. Idempotent
// — safe to retry on failure.
import { provisionTenant } from '../../utils/provision.js'

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
