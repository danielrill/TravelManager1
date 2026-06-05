// GET /api/trips/all — public. All trips + denormalised author_name.
// Supports ?q= search on title / destination / short_description / author_name.
// Paginated via ?limit= & ?offset= (infinite scroll); defaults to one page.
import { getDb } from '@travelmanager/shared/db'
import { cached } from '@travelmanager/shared/cache'

const PAGE = 24
const MAX_PAGE = 100

// Clamp a query param to an integer in [min, max], falling back to `fallback`.
function clampInt(v, fallback, min, max) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

export default defineEventHandler(async (event) => {
  const db = getDb()
  const { q, limit, offset } = getQuery(event)
  const lim = clampInt(limit, PAGE, 1, MAX_PAGE)
  const off = clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER)

  const base = `SELECT id, title, destination, start_date, short_description,
                       user_uid, author_name
                FROM trips`

  if (q && String(q).trim()) {
    const search = `%${String(q).trim()}%`
    const { rows } = await db.query(
      `${base}
       WHERE title ILIKE $1 OR destination ILIKE $1 OR short_description ILIKE $1
          OR author_name ILIKE $1
       ORDER BY start_date DESC
       LIMIT $2 OFFSET $3`,
      [search, lim, off]
    )
    return rows
  }

  // Unfiltered public feed — high traffic, short TTL. Cache per page; all pages
  // busted together via invalidatePattern('trips:all') on any trip write.
  return cached(`trips:all:${lim}:${off}`, 30, async () => {
    const { rows } = await db.query(
      `${base} ORDER BY start_date DESC LIMIT $1 OFFSET $2`,
      [lim, off]
    )
    return rows
  })
})
