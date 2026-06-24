// POST /tasks/flush-usage — invoked every ~60s by a GKE CronJob. Drains the
// gateway's per-tenant Redis usage counters (api_request) and emits one aggregated
// UsageRecorded event per tenant/dimension. NOT under /api, so it's not reachable
// through the public gateway pipeline — the CronJob curls the pod directly.
import { getRedis } from '@travelmanager/shared/cache'
import { flushUsageCounters } from '@travelmanager/shared/metering'

export default defineEventHandler(async () => {
  const result = await flushUsageCounters(getRedis())
  return { ok: true, ...result }
})
