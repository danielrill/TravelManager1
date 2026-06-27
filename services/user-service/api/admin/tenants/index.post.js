// POST /api/admin/tenants { subdomain, plan?, name? } — onboard a standard tenant.
// Registers the tenant (provisioned_at NULL), then detaches a background job that asks
// the provisioner-service to create its dedicated Postgres pod + databases + schemas +
// app pods and marks it provisioned. Returns 202 immediately; the admin SPA polls
// /api/tenants/:id/status. Idempotent: re-running for the same subdomain re-provisions safely.
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
  const tenant = await upsertTenant(id, {
    name: b.name || subdomain,
    plan,
    subdomain,
    signup_code: genSignupCode(),
  })

  // 2. Provision the dedicated Postgres pod + databases + schemas + app pods in the
  // BACKGROUND. The provisioner waits for the Postgres pod and all app pods to become
  // ready — minutes of work, far longer than any proxy will hold an HTTP request (a
  // synchronous wait here returns a spurious 502 to the operator even when provisioning
  // succeeds). So we detach the job and let the admin SPA poll /api/tenants/:id/status.
  // The row stays un-provisioned (provisioned_at NULL) until the job marks it live, so a
  // failed/lost run is safely retryable by re-submitting the same subdomain.
  const provUrl = process.env.PROVISIONER_SERVICE_URL || 'http://localhost:3006'
  const headers = { ...traceHeaders(event), 'x-internal-token': process.env.PROVISIONER_INTERNAL_TOKEN || '' }

  const job = (async () => {
    await $fetch('/api/internal/provision-tenant', {
      method: 'POST',
      baseURL: provUrl,
      headers,
      body: { tenantId: id, plan },
    })
    // Mark live + bust the gateway's host→tenant cache so the subdomain resolves.
    await markProvisioned(id)
    invalidate(`tenanthost:${subdomain}`)
  })().catch((e) => {
    // Leave the row NULL so a retry can finish onboarding; surfaced via status poll.
    console.error(`[user-service] admin provisioning failed for ${id}:`, e?.data?.statusMessage || e?.message || e)
  })
  // Keep the worker alive past the response on serverless runtimes; a no-op on a
  // long-lived node server (the detached promise runs to completion regardless).
  event.waitUntil?.(job)

  setResponseStatus(event, 202)
  return { ok: true, status: 'provisioning', tenant }
})
