// PUT /api/trip-routes/:id — edit an activity/route (owner only).
import { tenantDb } from '@travelmanager/shared/tenant-db'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid route ID' })

  const { title, description } = await readBody(event)

  if (!title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Route title is required' })
  }
  if (title.trim().length > 120) {
    throw createError({ statusCode: 400, statusMessage: 'Title must be 120 characters or fewer' })
  }

  const db = tenantDb(event)
  const { rows } = await db.query(
    `UPDATE trip_routes
     SET title = $1, description = $2
     WHERE id = $3
       AND trip_id IN (SELECT id FROM trips WHERE user_uid = $4)
     RETURNING id, trip_id, title, description, created_at`,
    [title.trim(), description?.trim() ?? '', id, user.uid]
  )
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Route not found' })
  return rows[0]
})
