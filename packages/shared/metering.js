// Usage-metering emit helpers — the write side of usage-based billing. Hides the
// Pub/Sub topic name + Redis key conventions so callers never hand-roll them.
//
// Two emit strategies (see metering-service for the read side):
//   - recordUsage(): DIRECT emit of one UsageRecorded event. For low-volume,
//     high-value units (ai_recommendation, trip_created) where per-event
//     provenance + immediacy matter and the volume can't storm Pub/Sub.
//   - bumpUsageCounter(): increment a per-tenant Redis counter. For very-high-
//     volume units (api_request) the gateway aggregates in Redis and a cron
//     flushes the totals into ONE UsageRecorded event per tenant/dimension/window
//     (see flushUsageCounters) — collapsing millions of requests into a handful
//     of messages.
//
// Everything here is FAIL-OPEN: metering must never break or slow the request it
// is measuring. Callers should not await recordUsage into the response path.
import { publishEvent } from './pubsub.js'

export const USAGE_TOPIC = 'UsageRecorded'

// UTC 'YYYY-MM' — the billing period an event belongs to. Stamped at occurrence
// so a late-delivered message lands in the period it happened in, not ingestion.
export function currentPeriod(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Redis key for the gateway's aggregated counters: a hash per tenant+period whose
// fields are dimensions. HINCRBY is atomic and cheap.
export function usageCounterKey(tenantId, period = currentPeriod()) {
  return `usage:${tenantId}:${period}`
}

// Direct emit. idempotencyKey MUST be deterministic for the logical event (e.g.
// `trip:<id>`) so an at-least-once redelivery dedupes at the consumer. Returns the
// publish result; callers in a request path should `.catch()` and not await.
export async function recordUsage(tenantId, dimension, quantity, { idempotencyKey, source = '', occurredAt, plan = '' } = {}) {
  if (!tenantId || tenantId === 'default') return 'skipped' // free tier is unmetered
  if (!idempotencyKey) throw new Error('recordUsage requires an idempotencyKey')
  const period = currentPeriod()
  return publishEvent(
    USAGE_TOPIC,
    {
      tenantId,
      dimension,
      quantity: Number(quantity) || 0,
      billingPeriod: period,
      idempotencyKey,
      source,
      plan,
      occurredAt: occurredAt || new Date().toISOString(),
      // gauge dimensions (active_seat) overwrite the counter instead of summing.
      gauge: dimension === 'active_seat',
    },
    { tenantId, dimension },
  )
}

// Fire-and-forget Redis increment for the gateway hot path. Fails open silently
// (mirrors ratelimit.allow): any Redis problem just under-counts one request.
export async function bumpUsageCounter(redis, tenantId, dimension, by = 1) {
  if (!redis) return
  if (!tenantId || tenantId === 'default') return
  try {
    const key = usageCounterKey(tenantId)
    await redis.hincrby(key, dimension, by)
    // TTL well past the flush interval so an idle tenant's counter still survives
    // until the next flush, but a forgotten key eventually evicts.
    await redis.expire(key, 3600)
  } catch {
    // never block traffic on the meter
  }
}

// Cron side: atomically read-and-reset every tenant/dimension counter and emit one
// aggregated UsageRecorded per (tenant, dimension). The GETDEL-style reset is done
// in Lua so a concurrent HINCRBY between read and delete is never lost — it lands
// in the next window. The window-stamped idempotencyKey makes a cron retry safe.
const FLUSH_LUA = `
local key = KEYS[1]
local vals = redis.call('HGETALL', key)
if #vals > 0 then redis.call('DEL', key) end
return vals
`

export async function flushUsageCounters(redis, { windowStart, publish = publishEvent } = {}) {
  if (!redis) return { flushed: 0, tenants: 0 }
  const period = currentPeriod()
  const stamp = windowStart || Math.floor(Date.now() / 1000)
  let flushed = 0
  let tenants = 0
  // SCAN (non-blocking) for every tenant/period counter hash.
  const stream = redis.scanStream({ match: `usage:*:${period}`, count: 100 })
  for await (const batch of stream) {
    for (const key of batch) {
      // key = usage:<tenantId>:<period>
      const parts = key.split(':')
      const tenantId = parts[1]
      let flat
      try {
        flat = await redis.eval(FLUSH_LUA, 1, key)
      } catch {
        continue // leave the counter for the next window rather than lose it
      }
      if (!flat || !flat.length) continue
      tenants++
      // flat = [field, value, field, value, ...]
      for (let i = 0; i < flat.length; i += 2) {
        const dimension = flat[i]
        const quantity = Number(flat[i + 1]) || 0
        if (quantity <= 0) continue
        try {
          await publish(
            USAGE_TOPIC,
            {
              tenantId,
              dimension,
              quantity,
              billingPeriod: period,
              idempotencyKey: `flush:${tenantId}:${dimension}:${stamp}`,
              source: 'gateway-flush',
              occurredAt: new Date().toISOString(),
            },
            { tenantId, dimension },
          )
          flushed++
        } catch (e) {
          console.error('[metering] flush publish failed', e?.message || e)
        }
      }
    }
  }
  return { flushed, tenants }
}
