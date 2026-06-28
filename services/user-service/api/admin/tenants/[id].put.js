// PUT /api/admin/tenants/:id — update a tenant's plan, rate-limit override, branding,
// or (for enterprise) the customer's own custom domain. Does not re-provision (use
// POST for that). Body: { plan?, rate_limit_per_min?, name?, logo_url?, brand_color?,
// custom_domain? }.
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'
import { upsertTenant, PLANS } from '../../../utils/tenants.js'
import { requireAdmin } from '../../../utils/admin.js'

// Hostname: labels of [a-z0-9-] separated by dots, ≥1 dot. Lower-cased before check.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const b = await readBody(event)
  if (b.plan && !PLANS.includes(b.plan)) {
    throw createError({ statusCode: 400, statusMessage: `plan must be one of ${PLANS.join(', ')}` })
  }
  if (b.rate_limit_per_min != null && !(Number.isInteger(b.rate_limit_per_min) && b.rate_limit_per_min > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'rate_limit_per_min must be a positive integer' })
  }
  if (b.custom_domain) {
    b.custom_domain = String(b.custom_domain).toLowerCase().trim()
    if (!DOMAIN_RE.test(b.custom_domain)) {
      throw createError({ statusCode: 400, statusMessage: 'custom_domain must be a valid hostname' })
    }
  }

  const row = await upsertTenant(id, b)
  // Saving a custom domain starts the TLS runbook: customer points DNS at the cluster
  // ingress IP, then the domain is added to the ManagedCertificate + Firebase.
  if (b.custom_domain) {
    await getDb().query(`UPDATE tenants SET tls_status = 'pending' WHERE id = $1`, [id])
  }
  invalidate(`tenant:${id}`)
  if (row.subdomain) invalidate(`tenanthost:${row.subdomain}`)
  return row
})
