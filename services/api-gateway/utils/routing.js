// Path → service routing, public routes, and per-path feature gates.
import { planAllows } from '@travelmanager/shared/tiers'

// Ordered prefix → service-key table. First match wins.
const ROUTES = [
  { prefix: '/api/admin',        service: 'user' },
  { prefix: '/api/users',        service: 'user' },
  { prefix: '/api/tenants',      service: 'user' },
  { prefix: '/api/trips',        service: 'trip' },
  { prefix: '/api/locations',    service: 'trip' },
  { prefix: '/api/reviews',      service: 'trip' },
  { prefix: '/api/likes',        service: 'trip' },
  { prefix: '/api/travel-plans', service: 'trip' },
  { prefix: '/api/destinations', service: 'destination' },
  { prefix: '/api/b2b',          service: 'destination' },
  { prefix: '/api/feed',         service: 'social' },
  { prefix: '/api/alerts',       service: 'travelInfo' },
  { prefix: '/api/weather',      service: 'travelInfo' },
]

export function resolveService(path) {
  return ROUTES.find(r => path.startsWith(r.prefix))?.service ?? null
}

// Downstream base URLs, read from the environment AT RUNTIME (not via
// useRuntimeConfig, whose process.env defaults are frozen at build time).
export function serviceUrl(key) {
  switch (key) {
    case 'user':        return process.env.USER_SERVICE_URL        || 'http://localhost:3001'
    case 'trip':        return process.env.TRIP_SERVICE_URL        || 'http://localhost:3002'
    case 'destination': return process.env.DESTINATION_SERVICE_URL || 'http://localhost:3003'
    case 'social':      return process.env.SOCIAL_SERVICE_URL      || 'http://localhost:3004'
    case 'travelInfo':  return process.env.TRAVEL_INFO_SERVICE_URL || 'http://localhost:3005'
    default:            return null
  }
}

// serviceKey → in-cluster Service base name (for per-tenant pod routing).
const SERVICE_NAMES = {
  user: 'user-service',
  trip: 'trip-service',
  destination: 'destination-service',
  social: 'social-service',
  travelInfo: 'travel-info-service',
}

// Upstream for a request, accounting for dedicated per-tenant pods. A provisioned
// standard tenant runs its own <svc>-<tenant> Deployments, so its traffic routes
// there instead of the shared service. Falls back to the shared URL when dedicated
// pods are disabled (TENANT_DEDICATED_PODS!=1), the tenant is 'default', or the key
// has no per-tenant pod (e.g. nothing maps outside SERVICE_NAMES).
export function tenantServiceUrl(key, tenantId) {
  if (process.env.TENANT_DEDICATED_PODS !== '1' || !tenantId || tenantId === 'default') {
    return serviceUrl(key)
  }
  const name = SERVICE_NAMES[key]
  return name ? `http://${name}-${tenantId}:8080` : serviceUrl(key)
}

// Routes reachable without a token.
export function isPublic(path, method) {
  if (path === '/api/trips/all') return true
  if (path.startsWith('/api/destinations')) return true
  if (path === '/api/tenants/current' && method === 'GET') return true // host tenant info for the SPA
  if (path === '/api/tenants/verify-code' && method === 'POST') return true // pre-login access-code gate
  if (/^\/api\/tenants\/[^/]+$/.test(path) && method === 'GET') return true // white-label config
  if (/^\/api\/likes\/trip\/[^/]+$/.test(path) && method === 'GET') return true
  return false
}

// Paths a signed-in but not-yet-member user may call on a standard tenant host so
// they can bootstrap their profile and join via access code. Everything else
// requires membership.
export function isJoinBootstrap(path, method) {
  if (path === '/api/tenants/join' && method === 'POST') return true
  if (path === '/api/users/me' && method === 'GET') return true
  if (path === '/api/users' && method === 'POST') return true
  return false
}

// Internal endpoints must never be reachable through the public gateway.
export function isBlocked(path) {
  return path.startsWith('/api/internal') || path === '/api/plan-refs'
}

// Feature gating by plan. Returns null if allowed, else a reason string.
// NOTE: only the feed READ (`/api/feed`) is gated — the follow graph
// (`/api/feed/follows...`) is a free social primitive and must stay open.
export function featureGate(path, plan) {
  const bare = path.split('?')[0]
  if (bare === '/api/feed' && !planAllows(plan, 'feed')) {
    return 'The personalized feed requires the Standard plan or higher'
  }
  if (bare.startsWith('/api/b2b') && !planAllows(plan, 'b2bData')) {
    return 'B2B data access requires the Enterprise plan'
  }
  return null
}
