// GET /api/internal/trips-by-authors?uids=a,b,c[&q=term][&limit=&offset=] —
// trips authored by the given users, ordered by a popularity nudge then newest
// first (stable for pagination). Optional ?q= filters on
// title / destination / author_name; ?limit=/&offset= paginate (infinite
// scroll). Internal feed source for the Social service (query-time feed); not
// routed through the public gateway.
import { getDb } from '@travelmanager/shared/db'

const PAGE = 24
const MAX_PAGE = 100

// Clamp a query param to an integer in [min, max], falling back to `fallback`.
function clampInt(v, fallback, min, max) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

export default defineEventHandler(async (event) => {
  const { uids, q, limit, offset } = getQuery(event)
  const list = String(uids || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!list.length) return []

  const lim = clampInt(limit, PAGE, 1, MAX_PAGE)
  const off = clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER)

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
       ORDER BY (1 + LEAST(COALESCE(like_count, 0), 10) * 0.05) DESC, created_at DESC
       LIMIT $3 OFFSET $4`,
      [list, search, lim, off]
    )
    return rows
  }

  const { rows } = await db.query(
    `${select}
     WHERE user_uid = ANY($1)
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [list, lim, off]
  )
  return rows
})
