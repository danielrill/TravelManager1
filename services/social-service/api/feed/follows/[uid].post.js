// POST /api/feed/follows/:uid — follow another traveller.
import { tenantDb } from '@travelmanager/shared/tenant-db'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const followee = getRouterParam(event, 'uid')
  if (!followee || followee === user.uid) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid followee' })
  }

  const db = tenantDb(event)
  await db.query(
    `INSERT INTO follows (follower_uid, followee_uid) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [user.uid, followee]
  )
  return { success: true }
})
