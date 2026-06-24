import { describe, it, expect, vi, beforeEach } from 'vitest'

// recordUsage publishes via @travelmanager/shared/pubsub; mock it so we can assert
// the emitted payload without touching GCP. metering.js imports './pubsub.js',
// which resolves to the same module file, so this mock intercepts it.
vi.mock('@travelmanager/shared/pubsub', () => ({ publishEvent: vi.fn(() => Promise.resolve('mid')) }))

import {
  currentPeriod,
  usageCounterKey,
  recordUsage,
  bumpUsageCounter,
  flushUsageCounters,
  USAGE_TOPIC,
} from '@travelmanager/shared/metering'
import { publishEvent } from '@travelmanager/shared/pubsub'

beforeEach(() => publishEvent.mockClear())

describe('metering.currentPeriod', () => {
  it('formats a UTC YYYY-MM string', () => {
    expect(currentPeriod(new Date('2026-06-23T10:00:00Z'))).toBe('2026-06')
    expect(currentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
  })
})

describe('metering.usageCounterKey', () => {
  it('keys per tenant + period', () => {
    expect(usageCounterKey('tui', '2026-06')).toBe('usage:tui:2026-06')
  })
})

describe('metering.recordUsage', () => {
  it('skips the free/default tenant (unmetered)', async () => {
    expect(await recordUsage('default', 'trip_created', 1, { idempotencyKey: 'x' })).toBe('skipped')
    expect(publishEvent).not.toHaveBeenCalled()
  })
  it('requires an idempotency key', async () => {
    await expect(recordUsage('tui', 'trip_created', 1, {})).rejects.toThrow(/idempotencyKey/)
  })
  it('publishes a UsageRecorded event with the billing fields', async () => {
    await recordUsage('tui', 'trip_created', 1, { idempotencyKey: 'trip:42', plan: 'standard' })
    expect(publishEvent).toHaveBeenCalledTimes(1)
    const [topic, payload, attrs] = publishEvent.mock.calls[0]
    expect(topic).toBe(USAGE_TOPIC)
    expect(payload).toMatchObject({ tenantId: 'tui', dimension: 'trip_created', idempotencyKey: 'trip:42', plan: 'standard' })
    expect(payload.billingPeriod).toMatch(/^\d{4}-\d{2}$/)
    expect(attrs).toEqual({ tenantId: 'tui', dimension: 'trip_created' })
  })
  it('marks active_seat as a gauge', async () => {
    await recordUsage('tui', 'active_seat', 7, { idempotencyKey: 'seat:tui:2026-06:23' })
    expect(publishEvent.mock.calls[0][1].gauge).toBe(true)
  })
})

describe('metering.bumpUsageCounter', () => {
  it('HINCRBYs the tenant counter and never throws on Redis error', async () => {
    const redis = { hincrby: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) }
    await bumpUsageCounter(redis, 'tui', 'api_request', 1)
    expect(redis.hincrby).toHaveBeenCalledWith(expect.stringContaining('usage:tui:'), 'api_request', 1)

    const broken = { hincrby: vi.fn().mockRejectedValue(new Error('down')), expire: vi.fn() }
    await expect(bumpUsageCounter(broken, 'tui', 'api_request')).resolves.toBeUndefined()
  })
  it('skips default tenant and missing redis', async () => {
    const redis = { hincrby: vi.fn(), expire: vi.fn() }
    await bumpUsageCounter(redis, 'default', 'api_request')
    await bumpUsageCounter(null, 'tui', 'api_request')
    expect(redis.hincrby).not.toHaveBeenCalled()
  })
})

describe('metering.flushUsageCounters', () => {
  function fakeRedis(keysByBatch, hashFlat) {
    return {
      scanStream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const batch of keysByBatch) yield batch
        },
      }),
      eval: vi.fn().mockResolvedValue(hashFlat),
    }
  }
  it('drains each tenant counter into one aggregated event per dimension', async () => {
    const period = currentPeriod()
    const redis = fakeRedis([[`usage:tui:${period}`]], ['api_request', '5', 'trip_created', '2'])
    const publish = vi.fn(() => Promise.resolve('mid'))
    const res = await flushUsageCounters(redis, { windowStart: 1000, publish })

    expect(res).toEqual({ flushed: 2, tenants: 1 })
    expect(publish).toHaveBeenCalledTimes(2)
    const apiCall = publish.mock.calls.find((c) => c[1].dimension === 'api_request')
    expect(apiCall[1]).toMatchObject({
      tenantId: 'tui',
      dimension: 'api_request',
      quantity: 5,
      idempotencyKey: 'flush:tui:api_request:1000',
      source: 'gateway-flush',
    })
  })
  it('returns zero when redis is absent', async () => {
    expect(await flushUsageCounters(null)).toEqual({ flushed: 0, tenants: 0 })
  })
})
