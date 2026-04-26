// DELETE /api/trips/:id — owner-only delete
import { getDb } from '~~/server/utils/db.js'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  const id = Number(getRouterParam(event, 'id'))

  const db = getDb()
  const { rowCount } = await db.query(
    'DELETE FROM trips WHERE id = $1 AND user_uid = $2',
    [id, user.uid]
  )
  if (!rowCount) throw createError({ statusCode: 404 })
  return { success: true }
})
