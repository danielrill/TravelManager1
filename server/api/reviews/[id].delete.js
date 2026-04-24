// DELETE /api/reviews/:id — reviewer_id from token, not body
import { getDb } from '~~/server/utils/db.js'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const id = Number(getRouterParam(event, 'id'))
  const db = getDb()

  const { rowCount } = await db.query(
    'DELETE FROM reviews WHERE id = $1 AND reviewer_id = $2',
    [id, user.uid]
  )
  if (!rowCount) throw createError({ statusCode: 403, statusMessage: 'Review not found or not yours' })
  return { ok: true }
})
