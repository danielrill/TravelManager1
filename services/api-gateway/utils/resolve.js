// Resolve a caller's tenant, plan and role from the User service. Cached per
// uid (60s) in Redis so we don't hit the User service on every request AND the
// cache is shared across gateway replicas (in-process caching gave each replica
// its own copy — wasteful and inconsistent under HPA scale-out). Fails open: if
// Redis is down `cached` just runs the loader every time.
import { cached } from '@travelmanager/shared/cache'

const TTL_SEC = 60

export async function resolveTenantPlan(uid) {
  return cached(`tenantplan:${uid}`, TTL_SEC, async () => {
    const userUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
    let tenantId = 'default'
    let role = 'traveler'
    let plan = 'free'

    try {
      // Internal endpoint exposes tenant_id + role; the public /api/users/:id omits
      // them, so the membership guard must read this one.
      const u = await $fetch(`/api/internal/users/${uid}`, { baseURL: userUrl })
      tenantId = u.tenant_id || 'default'
      role = u.role || 'traveler'
    } catch {
      // User row not created yet (first login before POST /api/users) — defaults.
    }

    try {
      // Internal endpoint exposes the plan; the public /api/tenants/:id does not.
      const t = await $fetch(`/api/internal/tenants/${tenantId}`, { baseURL: userUrl })
      plan = t.plan || 'free'
    } catch {
      // Tenant missing — default plan.
    }

    return { tenantId, plan, role }
  })
}
