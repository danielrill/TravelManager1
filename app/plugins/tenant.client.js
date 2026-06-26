// Resolve the host tenant once at startup so pages/middleware can route by it
// synchronously (e.g. send a non-member on a standard subdomain to the access-code
// gate instead of the login page). Free apex → { id: 'default', ... }.
export default defineNuxtPlugin(async () => {
  if (!import.meta.client) return
  if (useAdminHost()) return // admin host is not a tenant — no /api/tenants here
  const tenant = useState('currentTenant', () => undefined)
  if (tenant.value !== undefined) return
  const { apiFetch } = useApiFetch()
  try {
    tenant.value = await apiFetch('/api/tenants/current')
  } catch (e) {
    const status = e?.status ?? e?.statusCode ?? e?.response?.status
    // Unknown subdomain: the gateway 404s because no tenant is registered for this
    // host. Show the not-found page (error.vue) instead of falling through to the
    // login/register screen. Transient/other errors fail open to apex behaviour.
    if (status === 404) {
      tenant.value = null
      return showError(createError({ statusCode: 404, statusMessage: 'Workspace not found', fatal: true }))
    }
    tenant.value = null
  }
})
