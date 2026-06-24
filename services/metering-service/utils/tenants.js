// Fetch the tenant roster from the user-service control-plane. Billing jobs iterate
// the BILLABLE tenants (provisioned, non-free) — the free 'default' tenant is
// unmetered, so it's excluded from seat snapshots and invoices.
export async function listBillableTenants() {
  const userUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
  const rows = await globalThis.$fetch('/api/internal/tenants', { baseURL: userUrl })
  return (rows || []).filter((t) => t?.id && t.id !== 'default' && t.plan !== 'free' && t.provisioned_at)
}

// Count a tenant's members (seats). The internal users list is tenant-scopable;
// it's capped per page, so page through it for an exact count.
export async function countTenantSeats(tenantId) {
  const userUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
  const pageSize = 1000
  let offset = 0
  let total = 0
  for (;;) {
    const uids = await globalThis.$fetch('/api/internal/users', {
      baseURL: userUrl,
      query: { tenant: tenantId, limit: pageSize, offset },
    })
    const n = (uids || []).length
    total += n
    if (n < pageSize) break
    offset += pageSize
  }
  return total
}
