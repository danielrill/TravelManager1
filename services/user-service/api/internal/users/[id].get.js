// GET /api/internal/users/:id — tenant + role for a uid. Internal only
// (gateway-blocked). The gateway's resolveTenantPlan reads this to enforce the
// tenant membership guard and feature gating. The PUBLIC /api/users/:id omits
// tenant_id/role on purpose, so resolution must use this internal endpoint.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'id')
  const db = getDb()
  const { rows } = await db.query(
    'SELECT firebase_uid, tenant_id, role FROM users WHERE firebase_uid = $1',
    [uid]
  )
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return rows[0]
})
