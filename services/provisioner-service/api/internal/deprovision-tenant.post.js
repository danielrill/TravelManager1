// POST /api/internal/deprovision-tenant { tenantId } — tear down a standard
// tenant's dedicated Postgres pod + PVC + Service + NetworkPolicy. Internal only
// (gateway-blocked); called by the user-service admin delete flow. Idempotent.
import { deleteTenantPostgres, deleteTenantApps } from '../../utils/k8s.js'

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/

export default defineEventHandler(async (event) => {
  const { tenantId } = await readBody(event)
  if (!tenantId || tenantId === 'default' || !ID_RE.test(String(tenantId))) {
    throw createError({ statusCode: 400, statusMessage: 'valid tenantId required' })
  }
  try {
    const apps = await deleteTenantApps(String(tenantId))
    const res = await deleteTenantPostgres(String(tenantId))
    return { ok: true, ...res, apps }
  } catch (e) {
    console.error('[provisioner] deprovision-tenant failed', e)
    throw createError({ statusCode: 500, statusMessage: `Teardown failed: ${e?.message || e}` })
  }
})
