// POST /api/tasks/period-rollup — invoked at the month boundary by a GKE CronJob.
// Finalises the PRIOR period: computes each billable tenant's bill at the rates in
// effect and freezes it into the invoices table (idempotent upsert). Freezing
// makes historical bills immutable even if rate cards change later. Optional
// ?period=YYYY-MM overrides which period to finalise (re-runs are safe).
import { listBillableTenants } from '../../utils/tenants.js'
import { projectCost } from '../../utils/billing.js'
import { getDb } from '@travelmanager/shared/db'

// Prior UTC month relative to now (e.g. run on the 1st, bill last month).
function priorPeriod(d = new Date()) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

export default defineEventHandler(async (event) => {
  const period = String(getQuery(event).period || priorPeriod())
  const db = getDb()
  const tenants = await listBillableTenants()
  const results = []
  for (const t of tenants) {
    try {
      const bill = await projectCost(t.id, t.plan, period, db)
      await db.query(
        `INSERT INTO invoices (tenant_id, billing_period, plan, total_cents, lines, finalized_at)
         VALUES ($1,$2,$3,$4,$5::jsonb, NOW())
         ON CONFLICT (tenant_id, billing_period)
         DO UPDATE SET plan = EXCLUDED.plan, total_cents = EXCLUDED.total_cents,
                       lines = EXCLUDED.lines, finalized_at = NOW()`,
        [t.id, period, t.plan, bill.totalCents, JSON.stringify(bill.lines)],
      )
      results.push({ tenantId: t.id, totalCents: bill.totalCents })
    } catch (e) {
      console.error('[metering-service] rollup failed', t.id, e?.message || e)
      results.push({ tenantId: t.id, error: String(e?.message || e) })
    }
  }
  return { ok: true, period, invoiced: results }
})
