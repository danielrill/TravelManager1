// POST /api/admin/tenants { subdomain, plan?, name? } — onboard a standard tenant.
// Registers the tenant (provisioned_at NULL), asks the provisioner-service to
// create its dedicated Postgres pod + databases + schemas, then marks it
// provisioned. Idempotent: re-running for the same subdomain re-provisions safely.
import { invalidate } from '@travelmanager/shared/cache'
import { upsertTenant, markProvisioned, genSignupCode, PLANS } from '../../../utils/tenants.js'
import { requireAdmin, validateSubdomain } from '../../../utils/admin.js'
import { traceHeaders } from '@travelmanager/shared/trace'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const b = await readBody(event)
  const subdomain = validateSubdomain(b.subdomain)
  const id = subdomain // tenant id == subdomain slug
  const plan = b.plan || 'standard'
  if (!PLANS.includes(plan) || plan === 'free') {
    throw createError({ statusCode: 400, statusMessage: 'plan must be standard or enterprise' })
  }

  // 1. Register the tenant (not yet live) with a generated access code the
  //    operator will share with the customer.
  let tenant = await upsertTenant(id, {
    name: b.name || subdomain,
    plan,
    subdomain,
    signup_code: genSignupCode(),
  })

  // 2. Provision the dedicated Postgres pod + databases + schemas.
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
    // Leave the row in place (provisioned_at still NULL) so the operator can retry.
    throw createError({ statusCode: 502, statusMessage: `Provisioning failed: ${e?.data?.statusMessage || e?.message || e}` })
  }

  // 3. Mark live + bust the gateway's host→tenant cache so the subdomain resolves.
  await markProvisioned(id)
  invalidate(`tenanthost:${subdomain}`)
  tenant = { ...tenant, provisioned_at: new Date().toISOString() }

  return { ok: true, tenant, provision }
})
