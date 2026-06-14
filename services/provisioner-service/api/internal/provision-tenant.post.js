// POST /api/internal/provision-tenant { tenantId } — create a standard tenant's
// dedicated Postgres pod, databases and schemas. Internal only (gateway-blocked);
// called by the user-service admin flow. Idempotent — safe to retry on failure.
import { provisionTenant } from '../../utils/provision.js'

export default defineEventHandler(async (event) => {
  const { tenantId } = await readBody(event)
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenantId required' })
  try {
    const report = await provisionTenant(String(tenantId))
    return { ok: true, ...report }
  } catch (e) {
    console.error('[provisioner] provision-tenant failed', e)
    throw createError({ statusCode: 500, statusMessage: `Provisioning failed: ${e?.message || e}` })
  }
})
