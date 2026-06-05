// GET /api/trips/all — public. All trips + denormalised author_name.
// Supports ?q= search on title / destination / short_description.
import { getDb } from '@travelmanager/shared/db'
import { cached } from '@travelmanager/shared/cache'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const { q } = getQuery(event)

  const base = `SELECT id, title, destination, start_date, short_description,
                       user_uid, author_name
                FROM trips`

  if (q && String(q).trim()) {
    const search = `%${String(q).trim()}%`
    const { rows } = await db.query(
      `${base}
       WHERE title ILIKE $1 OR destination ILIKE $1 OR short_description ILIKE $1
       ORDER BY start_date DESC`,
      [search]
    )
    return rows
  }

  // Unfiltered public feed — high traffic, short TTL (busted on any trip write).
  return cached('trips:all', 30, async () => {
    const { rows } = await db.query(`${base} ORDER BY start_date DESC`)
    return rows
  })
})
