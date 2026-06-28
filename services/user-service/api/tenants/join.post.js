// POST /api/tenants/join { code } — join the host tenant by access code. Authed,
// but membership-exempt at the gateway (a not-yet-member must be able to call it).
// On a correct code it sets the caller's tenant_id to the host tenant, making them
// a member. The host tenant comes from the gateway's x-tenant-id (the subdomain).
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'
import { checkSignupCode } from '../../utils/tenants.js'

export default defineEventHandler(async (event) => {
  const ctx = event.context.user
  if (!ctx?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // A dedicated enterprise cluster has no access-code join — every user on the
  // customer's own domain already belongs to the single tenant (see users POST).
  if (process.env.FIXED_TENANT_ID) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const { code } = await readBody(event)
  const tenantId = ctx.tenantId
  if (!tenantId || tenantId === 'default') {
    throw createError({ statusCode: 400, statusMessage: 'Not a tenant workspace' })
  }
  if (!(await checkSignupCode(tenantId, code))) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid access code' })
  }

  // Make the caller a member. Upsert so a brand-new user (no row yet) joins
  // directly; an existing user is moved into the tenant.
  const db = getDb()
  const { rows } = await db.query(
    `INSERT INTO users (firebase_uid, email, name, tenant_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firebase_uid) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
     RETURNING firebase_uid, email, name, tenant_id, role`,
    [ctx.uid, ctx.email ?? '', ctx.name ?? ctx.email ?? '', tenantId]
  )
  invalidate(`user:${ctx.uid}`, `tenantplan:${ctx.uid}`)
  return { ok: true, tenant_id: tenantId, user: rows[0] }
})
