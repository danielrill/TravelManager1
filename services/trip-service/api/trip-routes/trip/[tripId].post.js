// POST /api/trip-routes/trip/:tripId — add an activity/route (owner only).
import { tenantDb } from '@travelmanager/shared/tenant-db'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  const tripId = Number(getRouterParam(event, 'tripId'))
  if (!tripId) throw createError({ statusCode: 400, statusMessage: 'Invalid trip ID' })

  const { title, description } = await readBody(event)

  if (!title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Route title is required' })
  }
  if (title.trim().length > 120) {
    throw createError({ statusCode: 400, statusMessage: 'Title must be 120 characters or fewer' })
  }

  const db = tenantDb(event)

  const { rows: ownerRows } = await db.query(
    'SELECT 1 FROM trips WHERE id = $1 AND user_uid = $2',
    [tripId, user.uid]
  )
  if (!ownerRows.length) throw createError({ statusCode: 403, statusMessage: 'Not your trip' })

  const { rows } = await db.query(
    `INSERT INTO trip_routes (trip_id, title, description)
     VALUES ($1, $2, $3)
     RETURNING id, trip_id, title, description, created_at`,
    [tripId, title.trim(), description?.trim() ?? '']
  )
  return rows[0]
})
