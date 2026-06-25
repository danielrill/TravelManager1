// GET /api/admin/usage/bulk?period=YYYY-MM — operator billing overview: usage +
// projected cost for EVERY billable tenant in one call, so the admin console can
// render an all-tenants table without an N+1 fan-out from the browser. Per-tenant
// price overrides are already baked in by projectCost (via resolveRateCard).
// Static `bulk` route resolves ahead of the dynamic `[tenantId]` route in Nitro.
import { currentPeriod } from '@travelmanager/shared/metering'
import { requireAdmin } from '../../../utils/admin.js'
import { projectCost } from '../../../utils/billing.js'
import { listBillableTenants } from '../../../utils/tenants.js'
import { shapeBulk } from '../../../utils/bulk-usage.js'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const period = String(getQuery(event).period || currentPeriod())
  const tenants = await listBillableTenants()
  const projections = await Promise.all(
    tenants.map((t) => projectCost(t.id, t.plan, period)),
  )
  return shapeBulk(tenants, projections, period)
})
