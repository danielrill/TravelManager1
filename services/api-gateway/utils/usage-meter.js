// Gateway-side usage meter for the api_request dimension. Increments a per-tenant
// Redis counter (hash field per dimension) on every billable request. A cron
// (routes/tasks/flush-usage) periodically drains these counters into ONE
// aggregated UsageRecorded event per tenant — so millions of requests never become
// millions of Pub/Sub messages.
//
// FAIL-OPEN, fire-and-forget: must never block or slow the request it measures.
// Callers should NOT await this into the response path.
import { getRedis } from '@travelmanager/shared/cache'
import { bumpUsageCounter } from '@travelmanager/shared/metering'

export function meterApiRequest(tenantId) {
  // bumpUsageCounter already no-ops on 'default'/missing tenant and swallows
  // errors; we additionally guard the (sync) getRedis call.
  try {
    bumpUsageCounter(getRedis(), tenantId, 'api_request', 1)
  } catch {
    // never throw into the gateway hot path
  }
}
