// Single source of truth for "where should this user go now". Hardcoding /trips in
// the auth pages ping-ponged register ↔ trips on a standard tenant: a logged-in
// NON-member sent to /trips got a 403 from the gateway, /trips bounced to /register,
// register's onMounted saw the user and sent them back to /trips → flicker loop.
//
// Decide from the HOST tenant + the caller's membership instead:
//   admin host                          → /admin (operator console)
//   standard tenant, not a member        → /join  (access-code gate)
//   standard tenant member, or free apex → /trips
//   logged out (non-admin)               → standard ? /join : /register
export const useLanding = () => {
  const { user } = useAuth()
  const tenant = useState('currentTenant', () => undefined)

  return async function landingPath() {
    if (useAdminHost()) return '/admin'

    // Resolve the host tenant once (the plugin usually has it already).
    if (tenant.value === undefined) {
      try { tenant.value = await useApiFetch().apiFetch('/api/tenants/current') } catch { tenant.value = null }
    }
    const standard = tenant.value && tenant.value.id !== 'default'

    if (!user.value) return standard ? '/join' : '/register'
    if (standard && user.value.tenant_id !== tenant.value.id) return '/join'
    return '/trips'
  }
}
