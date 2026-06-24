// POST /api/tasks/seat-snapshot — invoked daily by a GKE CronJob. For each
// billable tenant, count its seats and ingest an active_seat GAUGE event (the
// counter is OVERWRITTEN, not summed). Ingest is in-process (handleUsage) rather
// than via Pub/Sub — this job lives inside metering-service, so a round-trip
// through the topic would be pointless and would also no-op under PUBSUB_DISABLED.
import { currentPeriod } from '@travelmanager/shared/metering'
import { listBillableTenants, countTenantSeats } from '../../utils/tenants.js'
import { handleUsage } from '../../utils/ingest.js'

export default defineEventHandler(async () => {
  const period = currentPeriod()
  const day = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD
  const tenants = await listBillableTenants()
  const results = []
  for (const t of tenants) {
    try {
      const seats = await countTenantSeats(t.id)
      await handleUsage({
        tenantId: t.id,
        dimension: 'active_seat',
        quantity: seats,
        billingPeriod: period,
        idempotencyKey: `seat:${t.id}:${period}:${day}`,
        source: 'seat-snapshot',
        gauge: true,
        plan: t.plan,
      })
      results.push({ tenantId: t.id, seats })
    } catch (e) {
      console.error('[metering-service] seat snapshot failed', t.id, e?.message || e)
      results.push({ tenantId: t.id, error: String(e?.message || e) })
    }
  }
  return { ok: true, period, day, tenants: results }
})
