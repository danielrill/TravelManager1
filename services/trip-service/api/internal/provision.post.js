// POST /api/internal/provision { tenantId } — bootstrap this service's schema in
// the given tenant's dedicated Postgres pod. Called by the provisioner after the
// pod + database exist. Idempotent (initTripDb uses CREATE ... IF NOT EXISTS).
// Internal only (gateway-blocked).
import { poolForTenant } from '@travelmanager/shared/tenant-db'
import { initTripDb } from '../../utils/schema.js'

export default defineEventHandler(async (event) => {
  const { tenantId } = await readBody(event)
  if (!tenantId || tenantId === 'default') {
    throw createError({ statusCode: 400, statusMessage: 'valid tenantId required' })
  }
  await initTripDb(poolForTenant(String(tenantId)))
  return { ok: true, service: 'trip', tenantId }
})
