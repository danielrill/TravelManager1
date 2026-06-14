// Gateway catch-all. Pipeline: route → block internal → resolve tenant from Host
// → public passthrough → verify JWT → admin gate (admin host) → tenant membership
// guard → rate limit → feature gate → proxy with injected identity headers.
//
// Tenant identity comes from the request Host (subdomain), NOT the user's row:
//   onecloudaway.de       → free 'default' tenant (shared DB)
//   admin.onecloudaway.de → operator onboarding app (email allowlist)
//   tui.onecloudaway.de   → standard tenant 'tui' (own Postgres pod)
import { getAuthClient } from '@travelmanager/shared/firebase'
import { getPlan } from '@travelmanager/shared/tiers'
import { resolveService, serviceUrl, tenantServiceUrl, isPublic, isBlocked, featureGate, isJoinBootstrap } from '../utils/routing.js'
import { resolveTenantPlan } from '../utils/resolve.js'
import { subdomainOf, isAdminSub, resolveTenantByHost } from '../utils/tenant-host.js'
import { allow } from '../utils/ratelimit.js'
import { proxyTo } from '../utils/proxy.js'

const skipAuth = process.env.GATEWAY_SKIP_AUTH === '1'
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0]

  if (!path.startsWith('/api/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (isBlocked(path)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const serviceKey = resolveService(path)
  if (!serviceKey) throw createError({ statusCode: 404, statusMessage: 'No route' })

  const target = serviceUrl(serviceKey)
  if (!target) throw createError({ statusCode: 502, statusMessage: 'Service unavailable' })

  // Host → subdomain → tenant.
  const host = event.node.req.headers['x-forwarded-host'] || event.node.req.headers['host']
  const sub = subdomainOf(host)
  const adminHost = isAdminSub(sub)
  const isAdminPath = path.startsWith('/api/admin')

  // Admin API is only valid on the admin host.
  if (isAdminPath && !adminHost) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // The admin host serves ONLY the operator control-plane. Every other path
  // (profile, trips, feed, tenant config, …) is unreachable here, so an operator
  // can never read a tenant's data through admin.* — no profile, no tenant data.
  if (adminHost && !isAdminPath) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Public routes (apex/tenant only, never admin host): proxy through with the
  // tenant header so tenant-routed services hit the right DB, but no identity.
  if (!adminHost && isPublic(path, event.method)) {
    const t = await resolveTenantByHost(sub)
    if (!t) throw createError({ statusCode: 404, statusMessage: 'Unknown tenant' })
    if (sub && !t.provisioned) throw createError({ statusCode: 503, statusMessage: 'Tenant not ready' })
    return proxyTo(event, tenantServiceUrl(serviceKey, t.id) + event.path, { 'x-tenant-id': t.id })
  }

  // Authenticate.
  let identity
  if (skipAuth) {
    const dbgUid = event.node.req.headers['x-debug-uid']
    if (!dbgUid) throw createError({ statusCode: 401, statusMessage: 'Missing x-debug-uid (skip-auth mode)' })
    const dbgEmail = event.node.req.headers['x-debug-email']
    identity = { uid: String(dbgUid), email: dbgEmail ? String(dbgEmail) : 'dev@example.com', name: 'Dev User' }
  } else {
    const authHeader = event.node.req.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      throw createError({ statusCode: 401, statusMessage: 'Missing token' })
    }
    try {
      const decoded = await getAuthClient().verifyIdToken(authHeader.slice(7))
      identity = { uid: decoded.uid, email: decoded.email ?? '', name: decoded.name ?? '' }
    } catch {
      throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
    }
  }

  // Admin host: operators only (email allowlist). Operate on the control-plane
  // (shared DB / default tenant) with full access.
  if (adminHost) {
    if (!ADMIN_EMAILS.includes((identity.email || '').toLowerCase())) {
      throw createError({ statusCode: 403, statusMessage: 'Operator access required' })
    }
    return proxyTo(event, target + event.path, {
      'x-user-uid': identity.uid,
      'x-user-email': identity.email,
      'x-user-name': encodeURIComponent(identity.name || ''),
      'x-tenant-id': 'default',
      'x-plan': 'enterprise',
      'x-role': 'admin',
    })
  }

  // Resolve the tenant from the Host, and the caller's own tenant + role.
  const hostTenant = await resolveTenantByHost(sub)
  if (!hostTenant) throw createError({ statusCode: 404, statusMessage: 'Unknown tenant' })
  if (sub && !hostTenant.provisioned) {
    throw createError({ statusCode: 503, statusMessage: 'Tenant not ready' })
  }

  const { tenantId: userTenant, role } = await resolveTenantPlan(identity.uid)

  // Membership guard: a standard tenant's subdomain is only for its members.
  // The free apex (default) is open to any authenticated user. A non-member may
  // still call the join/bootstrap paths so they can enter the access code.
  const member = hostTenant.id === 'default' || userTenant === hostTenant.id
  if (!member && !isJoinBootstrap(path, event.method)) {
    throw createError({ statusCode: 403, statusMessage: 'No access to this workspace' })
  }

  // Plan + rate limit come from the HOST's tenant (the product tier of the
  // subdomain), with an optional per-tenant rate override.
  const plan = hostTenant.plan
  const rate = hostTenant.rateLimitPerMin ?? getPlan(plan).rateLimitPerMin
  if (!(await allow(identity.uid, rate))) {
    throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded for your plan' })
  }

  // Feature gating.
  const denied = featureGate(path, plan)
  if (denied) throw createError({ statusCode: 403, statusMessage: denied })

  // Proxy with trusted identity headers — to the tenant's own pods when it has them.
  return proxyTo(event, tenantServiceUrl(serviceKey, hostTenant.id) + event.path, {
    'x-user-uid': identity.uid,
    'x-user-email': identity.email,
    'x-user-name': encodeURIComponent(identity.name || ''),
    'x-tenant-id': hostTenant.id,
    'x-plan': plan,
    'x-role': role,
  })
})
