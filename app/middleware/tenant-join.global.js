// On a standard tenant subdomain, a visitor who isn't a member is sent to /join
// (the access-code gate). The free apex (tenant 'default') and the admin host are
// never gated. Client-only: we need the resolved host tenant + auth state.
export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return
  if (useAdminHost()) return // operator console: never a tenant, never gated

  // Pages that must stay reachable so the user can actually join / sign in.
  const EXEMPT = ['/join', '/register', '/profile', '/admin']
  if (EXEMPT.some((p) => to.path === p || to.path.startsWith(p + '/'))) return

  const tenant = useState('currentTenant', () => undefined)
  if (tenant.value === undefined) {
    const { apiFetch } = useApiFetch()
    try { tenant.value = await apiFetch('/api/tenants/current') } catch { tenant.value = null }
  }
  // Free apex (or unknown) → no gate.
  if (!tenant.value || tenant.value.id === 'default') return

  const { user, authReady } = useAuth()
  if (!authReady.value) return // auth not restored yet; gate re-evaluates on next nav

  if (!user.value || user.value.tenant_id !== tenant.value.id) {
    return navigateTo('/join')
  }
})
