// GET /api/admin/usage/:tenantId?period=YYYY-MM — operator view of any tenant's
// usage + projected cost for a period, plus its finalised invoices. Plan is taken
// from the tenant's control-plane record.
import { getDb } from '@travelmanager/shared/db'
import { currentPeriod } from '@travelmanager/shared/metering'
import { requireAdmin } from '../../../utils/admin.js'
import { projectCost } from '../../../utils/billing.js'

async function tenantPlan(tenantId) {
  const userUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
  try {
    const rows = await globalThis.$fetch('/api/internal/tenants', { baseURL: userUrl })
    return (rows || []).find((t) => t.id === tenantId)?.plan || 'standard'
  } catch {
    return 'standard'
  }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const tenantId = getRouterParam(event, 'tenantId')
  const period = String(getQuery(event).period || currentPeriod())
  const plan = await tenantPlan(tenantId)

  const projection = await projectCost(tenantId, plan, period)
  const db = getDb()
  const { rows: invoices } = await db.query(
    `SELECT billing_period, plan, total_cents, lines, finalized_at
       FROM invoices WHERE tenant_id = $1 ORDER BY billing_period DESC LIMIT 24`,
    [tenantId],
  )
  return { ...projection, invoices }
})
