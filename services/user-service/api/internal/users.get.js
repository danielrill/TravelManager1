// GET /api/internal/users?limit=&offset= — paginated list of user uids. Used by
// the Social service's newsletter job to iterate every user (the Social service
// owns only the follow graph, not the user list). Internal; gateway-blocked.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const { limit, offset } = getQuery(event)
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000)
  const off = Math.max(Number(offset) || 0, 0)

  const db = getDb()
  const { rows } = await db.query(
    `SELECT firebase_uid AS uid FROM users ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
    [lim, off]
  )
  return rows.map(r => r.uid)
})
