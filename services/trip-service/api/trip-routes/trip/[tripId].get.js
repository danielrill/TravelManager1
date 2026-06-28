// GET /api/trip-routes/trip/:tripId — lightweight activities for a trip, ordered.
import { tenantDb } from '@travelmanager/shared/tenant-db'

export default defineEventHandler(async (event) => {
  const tripId = Number(getRouterParam(event, 'tripId'))
  if (!tripId) throw createError({ statusCode: 400, statusMessage: 'Invalid trip ID' })

  const db = tenantDb(event)
  const { rows } = await db.query(
    `SELECT id, trip_id, title, description, created_at
     FROM trip_routes
     WHERE trip_id = $1
     ORDER BY created_at ASC, id ASC`,
    [tripId]
  )
  return rows
})
