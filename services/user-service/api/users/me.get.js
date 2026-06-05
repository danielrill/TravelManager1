// GET /api/users/me — Postgres profile row for the authenticated user.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const ctx = event.context.user
  if (!ctx?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const db = getDb()
  const { rows } = await db.query(
    'SELECT firebase_uid, email, name, bio, home_city, avatar_url, tenant_id, role, created_at FROM users WHERE firebase_uid = $1',
    [ctx.uid]
  )
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  // `plan` isn't a users column — it lives on the tenant and is resolved by the
  // gateway, which forwards it as the trusted `x-plan` header (→ ctx.plan). Surface
  // it here so the SPA can gate features proactively instead of waiting for a 403.
  return { ...rows[0], plan: ctx.plan || 'free' }
})
