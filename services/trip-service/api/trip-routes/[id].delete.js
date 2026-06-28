// DELETE /api/trip-routes/:id — remove an activity/route (owner only).
import { tenantDb } from '@travelmanager/shared/tenant-db'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid route ID' })

  const db = tenantDb(event)
  const { rowCount } = await db.query(
    `DELETE FROM trip_routes
     WHERE id = $1
       AND trip_id IN (SELECT id FROM trips WHERE user_uid = $2)`,
    [id, user.uid]
  )
  if (!rowCount) throw createError({ statusCode: 404, statusMessage: 'Route not found' })
  return { success: true }
})
