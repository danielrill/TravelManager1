// Host-based tenant resolution. The subdomain of the request Host selects the
// tenant: the apex (onecloudaway.de / www) is the FREE 'default' tenant; a
// customer subdomain (tui.onecloudaway.de) is that standard tenant; 'admin' is
// the operator onboarding app. Results are cached in Redis (shared across
// gateway replicas), same pattern as resolve.js.
import { cached } from '@travelmanager/shared/cache'

const TTL_SEC = 60

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'onecloudaway.de'

// Extract the tenant subdomain from a Host header.
//   onecloudaway.de            -> ''        (apex / free)
//   www.onecloudaway.de        -> ''        (apex / free)
//   admin.onecloudaway.de      -> 'admin'   (operator app)
//   tui.onecloudaway.de        -> 'tui'     (standard tenant)
//   localhost / 127.0.0.1 / IP -> ''        (dev → free)
export function subdomainOf(host, root = ROOT_DOMAIN) {
  const h = String(host || '').split(':')[0].toLowerCase().trim()
  if (!h || h === root || h === `www.${root}`) return ''
  if (h.endsWith(`.${root}`)) {
    const label = h.slice(0, -(`.${root}`).length)
    // Only the first label is the tenant (defensive against a.b.onecloudaway.de).
    return label.split('.')[0]
  }
  return '' // unknown host (localhost, raw IP) → treat as apex/free for dev
}

export function isAdminSub(sub) {
  return sub === 'admin'
}

// Resolve a subdomain to a tenant record. Apex ('' / 'www') → the default/free
// tenant; otherwise look it up by subdomain via the user-service. Returns null
// for an unknown subdomain (gateway should 404). 'admin' is handled by the
// gateway before this is called and never reaches here.
export async function resolveTenantByHost(sub) {
  return cached(`tenanthost:${sub || '_apex'}`, TTL_SEC, async () => {
    const userUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'

    if (!sub || sub === 'www') {
      try {
        const t = await $fetch('/api/internal/tenants/default', { baseURL: userUrl })
        return normalize(t)
      } catch {
        return { id: 'default', plan: 'free', rateLimitPerMin: null }
      }
    }

    try {
      const t = await $fetch(`/api/internal/tenants/by-host/${sub}`, { baseURL: userUrl })
      return normalize(t)
    } catch {
      return null // unknown subdomain
    }
  })
}

function normalize(t) {
  return {
    id: t.id,
    plan: t.plan || 'free',
    rateLimitPerMin: t.rate_limit_per_min ?? null,
    provisioned: Boolean(t.provisioned_at),
  }
}
