// GET /api/internal/trips-by-authors?uids=a,b,c[&q=term] — trips authored by the
// given users, newest first. Optional ?q= filters on title / destination /
// author_name. Internal feed source for the Social service (query-time feed);
// not routed through the public gateway.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const { uids, q } = getQuery(event)
  const list = String(uids || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!list.length) return []

  const select = `SELECT id AS trip_id, user_uid AS author_uid, author_name, title,
            destination, dest_country, start_date,
            COALESCE(like_count, 0) AS like_count, created_at
     FROM trips`

  const db = getDb()

  if (q && String(q).trim()) {
    const search = `%${String(q).trim()}%`
    const { rows } = await db.query(
      `${select}
       WHERE user_uid = ANY($1)
         AND (title ILIKE $2 OR destination ILIKE $2 OR author_name ILIKE $2)
       ORDER BY created_at DESC
       LIMIT 200`,
      [list, search]
    )
    return rows
  }

  const { rows } = await db.query(
    `${select}
     WHERE user_uid = ANY($1)
     ORDER BY created_at DESC
     LIMIT 200`,
    [list]
  )
  return rows
})
