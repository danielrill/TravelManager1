// POST /api/tenants/self-serve { subdomain, confirm } — user-initiated tenant
// creation. Any authenticated user can upgrade themselves to a standard workspace
// from their profile after a (mock) payment step. Mirrors the admin onboarding
// flow (register → provision dedicated Postgres + app pods → mark live) but is
// gated on the caller, not the operator allowlist, and the caller is made a member
// of the workspace they just created. Idempotent retry for an un-provisioned slug.
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'
import { upsertTenant, markProvisioned, genSignupCode } from '../../utils/tenants.js'
import { validateSubdomain } from '../../utils/admin.js'
import { traceHeaders } from '@travelmanager/shared/trace'

export default defineEventHandler(async (event) => {
  const ctx = event.context.user
  if (!ctx?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const b = await readBody(event)
  // Mock payment gate: the SPA collects no real card details — it just confirms.
  if (!b.confirm) {
    throw createError({ statusCode: 402, statusMessage: 'Payment confirmation required' })
  }

  const subdomain = validateSubdomain(b.subdomain)
  const id = subdomain // tenant id == subdomain slug
  const db = getDb()

  // Refuse to hijack a workspace that already exists and is live.
  const existing = await db.query('SELECT provisioned_at FROM tenants WHERE id = $1', [id])
  if (existing.rows.length && existing.rows[0].provisioned_at) {
    throw createError({ statusCode: 409, statusMessage: `Workspace "${subdomain}" is already taken` })
  }

  // 1. Register the standard tenant (not yet live).
  let tenant = await upsertTenant(id, {
    name: b.name || subdomain,
    plan: 'standard',
    subdomain,
    signup_code: genSignupCode(),
  })

  // 2. Provision the dedicated Postgres pod + databases + schemas + app pods.
  const provUrl = process.env.PROVISIONER_SERVICE_URL || 'http://localhost:3006'
  let provision
  try {
    provision = await $fetch('/api/internal/provision-tenant', {
      method: 'POST',
      baseURL: provUrl,
      headers: { ...traceHeaders(event) },
      body: { tenantId: id },
    })
  } catch (e) {
    // Leave the row (provisioned_at NULL) so a retry can finish onboarding.
    throw createError({ statusCode: 502, statusMessage: `Provisioning failed: ${e?.data?.statusMessage || e?.message || e}` })
  }

  // 3. Mark live + make the creator a member of their new workspace.
  await markProvisioned(id)
  await db.query(
    `INSERT INTO users (firebase_uid, email, name, tenant_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firebase_uid) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
    [ctx.uid, ctx.email ?? '', ctx.name ?? ctx.email ?? '', id]
  )

  invalidate(`tenanthost:${subdomain}`, `user:${ctx.uid}`, `tenantplan:${ctx.uid}`)
  tenant = { ...tenant, provisioned_at: new Date().toISOString() }

  const rootDomain = process.env.ROOT_DOMAIN || 'onecloudaway.de'
  return { ok: true, tenant, url: `https://${subdomain}.${rootDomain}`, provision }
})
