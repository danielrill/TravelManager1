// POST /api/users
// Upserts a user row on first sign-up / first Google login.
// Identity comes from the gateway-verified token (event.context.user).
// `name` in the body is used only when creating a new row; ignored afterwards.
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'

export default defineEventHandler(async (event) => {
  const ctx = event.context.user
  if (!ctx?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { name } = await readBody(event)

  const db = getDb()

  // On a dedicated ENTERPRISE cluster (FIXED_TENANT_ID set) every user belongs to
  // that one tenant — there's no free apex and no access-code join. New users land
  // directly in it, and the configured customer admin is promoted to 'admin' on
  // first sign-up (the only way to bootstrap an operator on an isolated cluster).
  // On the central cluster, new users start in the free 'default' tenant — joining a
  // standard tenant is gated by an access code (POST /api/tenants/join), so creating a
  // profile on a subdomain must not silently grant membership.
  const fixedTenant = process.env.FIXED_TENANT_ID || ''
  const defaultTenant = fixedTenant || 'default'
  const adminEmail = (process.env.ENTERPRISE_ADMIN_EMAIL || '').toLowerCase()
  const isFirstAdmin = Boolean(fixedTenant && adminEmail && (ctx.email || '').toLowerCase() === adminEmail)
  const role = isFirstAdmin ? 'admin' : 'traveler'

  const { rows } = await db.query(
    `INSERT INTO users (firebase_uid, email, name, tenant_id, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (firebase_uid) DO UPDATE
       SET email = EXCLUDED.email,
           role  = CASE WHEN $6 THEN 'admin' ELSE users.role END
     RETURNING firebase_uid, email, name, bio, home_city, avatar_url, tenant_id, role, created_at`,
    [ctx.uid, ctx.email ?? '', name?.trim() ?? ctx.name ?? ctx.email ?? '', defaultTenant, role, isFirstAdmin]
  )

  invalidate(`user:${ctx.uid}`)   // bust public profile cache (fire-and-forget)

  // Mirror /api/users/me: attach the gateway-resolved plan so the SPA has it the
  // moment it hydrates user.value after sign-up (no separate fetch needed).
  return { ...rows[0], plan: ctx.plan || 'free' }
})
