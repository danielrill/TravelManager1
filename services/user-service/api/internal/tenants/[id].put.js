// PUT /api/internal/tenants/:id — upsert a tenant's plan + white-label config.
// Internal/ops endpoint (gateway-blocked); used to provision Standard/Enterprise
// customers and their branding. Body: { name?, plan?, logo_url?, brand_color?,
// custom_domain?, subdomain?, rate_limit_per_min? }.
import { invalidate } from '@travelmanager/shared/cache'
import { upsertTenant, PLANS } from '../../../utils/tenants.js'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const b = await readBody(event)
  if (b.plan && !PLANS.includes(b.plan)) {
    throw createError({ statusCode: 400, statusMessage: `plan must be one of ${PLANS.join(', ')}` })
  }

  const row = await upsertTenant(id, b)
  // Bust public white-label cache and the gateway's host→tenant cache so a plan
  // / branding change is picked up promptly.
  invalidate(`tenant:${id}`)
  if (row.subdomain) invalidate(`tenanthost:${row.subdomain}`)
  return row
})
