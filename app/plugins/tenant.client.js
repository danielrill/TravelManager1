// Resolve the host tenant once at startup so pages/middleware can route by it
// synchronously (e.g. send a non-member on a standard subdomain to the access-code
// gate instead of the login page). Free apex → { id: 'default', ... }.
export default defineNuxtPlugin(async () => {
  if (!import.meta.client) return
  if (useAdminHost()) return // admin host is not a tenant — no /api/tenants here
  const tenant = useState('currentTenant', () => undefined)
  if (tenant.value !== undefined) return
  const { apiFetch } = useApiFetch()
  try { tenant.value = await apiFetch('/api/tenants/current') } catch { tenant.value = null }
})
