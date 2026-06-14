// GET /api/internal/users?limit=&offset= — paginated list of user uids. Used by
// the Social service's newsletter job to iterate every user (the Social service
// owns only the follow graph, not the user list). Internal; gateway-blocked.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const { limit, offset, tenant } = getQuery(event)
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000)
  const off = Math.max(Number(offset) || 0, 0)

  const db = getDb()
  // Optional ?tenant= scopes the list to one tenant's members so the per-tenant
  // newsletter job only emails that tenant's users.
  const { rows } = tenant
    ? await db.query(
        `SELECT firebase_uid AS uid FROM users WHERE tenant_id = $3 ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
        [lim, off, String(tenant)]
      )
    : await db.query(
        `SELECT firebase_uid AS uid FROM users ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
        [lim, off]
      )
  return rows.map(r => r.uid)
})
