// GET /api/users/:id — public profile read. :id is the firebase_uid (TEXT).
import { getDb } from '@travelmanager/shared/db'
import { cached } from '@travelmanager/shared/cache'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'id')
  if (!uid) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  // Public profile — changes only on the user's own edits (which bust user:<uid>).
  const profile = await cached(`user:${uid}`, 300, async () => {
    const db = getDb()
    const { rows } = await db.query(
      'SELECT firebase_uid, email, name, bio, home_city, avatar_url, created_at FROM users WHERE firebase_uid = $1',
      [uid]
    )
    return rows[0] ?? null
  })
  if (!profile) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return profile
})
