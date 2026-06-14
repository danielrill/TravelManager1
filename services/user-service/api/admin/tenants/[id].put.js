// PUT /api/admin/tenants/:id — update a tenant's plan, rate-limit override, or
// branding from the admin UI. Does not re-provision (use POST for that).
// Body: { plan?, rate_limit_per_min?, name?, logo_url?, brand_color? }.
import { invalidate } from '@travelmanager/shared/cache'
import { upsertTenant, PLANS } from '../../../utils/tenants.js'
import { requireAdmin } from '../../../utils/admin.js'

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

  const row = await upsertTenant(id, b)
  invalidate(`tenant:${id}`)
  if (row.subdomain) invalidate(`tenanthost:${row.subdomain}`)
  return row
})
