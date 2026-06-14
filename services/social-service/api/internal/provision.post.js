// POST /api/internal/provision { tenantId } — bootstrap this service's schema in
// the given tenant's dedicated Postgres pod. Called by the provisioner after the
// pod + database exist. Idempotent. Internal only (gateway-blocked).
import { poolForTenant } from '@travelmanager/shared/tenant-db'
import { initSocialDb } from '../../utils/schema.js'

export default defineEventHandler(async (event) => {
  const { tenantId } = await readBody(event)
  if (!tenantId || tenantId === 'default') {
    throw createError({ statusCode: 400, statusMessage: 'valid tenantId required' })
  }
  await initSocialDb(poolForTenant(String(tenantId)))
  return { ok: true, service: 'social', tenantId }
})
