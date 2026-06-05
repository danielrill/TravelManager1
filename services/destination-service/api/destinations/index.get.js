// GET /api/destinations — all pre-seeded European destinations.
import { getDb } from '@travelmanager/shared/db'
import { cached } from '@travelmanager/shared/cache'

export default defineEventHandler(async () => {
  // Seed data — changes only on a reseed, so cache hard (24h).
  return cached('dest:all', 86_400, async () => {
    const db = getDb()
    const { rows } = await db.query(
      'SELECT id, country, city, emoji, description FROM destinations ORDER BY country ASC'
    )
    return rows
  })
})
