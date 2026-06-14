// GET /api/trips/:id — any authenticated user can view any trip.
import { tenantDb } from '@travelmanager/shared/tenant-db'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400 })

  const db = tenantDb(event)
  const { rows } = await db.query('SELECT * FROM trips WHERE id = $1', [id])
  if (!rows.length) throw createError({ statusCode: 404 })
  return rows[0]
})
