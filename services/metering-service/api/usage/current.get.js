// GET /api/usage/current — TENANT-facing. Returns the caller tenant's current-
// period usage + projected cost. Tenant + plan come from the gateway-stamped
// headers (x-tenant-id / x-plan), so a tenant can only ever see its own bill.
import { requireUser } from '@travelmanager/shared/identity'
import { currentPeriod } from '@travelmanager/shared/metering'
import { projectCost } from '../../utils/billing.js'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const tenantId = user.tenantId || 'default'
  if (tenantId === 'default') {
    // Free tier is unmetered — nothing to bill.
    return { tenantId, plan: 'free', billingPeriod: currentPeriod(), totalCents: 0, lines: [], usage: {} }
  }
  return projectCost(tenantId, user.plan || 'standard', currentPeriod())
})
