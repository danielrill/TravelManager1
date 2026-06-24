// UsageRecorded ingestion — idempotent insert + counter rollup in ONE transaction.
//
// Idempotency is the whole game: Pub/Sub is at-least-once, so the same event may
// arrive twice. We INSERT the event with ON CONFLICT (tenant_id, idempotency_key)
// DO NOTHING; the counter is only touched when a row was ACTUALLY inserted. A
// redelivered duplicate inserts nothing → counter unchanged → never double-counts.
//
// Sum vs gauge: most dimensions accumulate (api_request, trips). active_seat is a
// GAUGE — the daily snapshot is the authoritative count, so its counter is
// OVERWRITTEN, not summed.
import { getDb } from '@travelmanager/shared/db'
import { isDimension } from '@travelmanager/shared/rating'
import { recordUsageMetric } from '@travelmanager/shared/metrics'
import { control } from './control.js'

export async function handleUsage(payload) {
  const { tenantId, dimension, quantity, billingPeriod, idempotencyKey, source = '', occurredAt, gauge, plan = '' } = payload || {}

  control.usage.lastMessageAt = new Date().toISOString()

  // Validate — bad messages are permanent failures; the caller (subscriber/push)
  // acks/drops them rather than redelivering forever.
  if (!tenantId || !isDimension(dimension) || !billingPeriod || !idempotencyKey) {
    control.usage.errors++
    throw new Error(`invalid usage event: ${JSON.stringify({ tenantId, dimension, billingPeriod, idempotencyKey })}`)
  }
  const qty = Number(quantity) || 0

  const db = getDb()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const ins = await client.query(
      `INSERT INTO usage_events (tenant_id, dimension, quantity, billing_period, idempotency_key, source, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [tenantId, dimension, qty, billingPeriod, idempotencyKey, source, occurredAt || null],
    )

    if (ins.rowCount === 0) {
      // Duplicate redelivery — counter already reflects this event.
      await client.query('COMMIT')
      control.usage.duplicates++
      return { duplicate: true }
    }

    if (gauge) {
      // Authoritative snapshot — overwrite the period total.
      await client.query(
        `INSERT INTO usage_counters (tenant_id, dimension, billing_period, total_quantity, updated_at)
         VALUES ($1,$2,$3,$4, NOW())
         ON CONFLICT (tenant_id, dimension, billing_period)
         DO UPDATE SET total_quantity = EXCLUDED.total_quantity, updated_at = NOW()`,
        [tenantId, dimension, billingPeriod, qty],
      )
    } else {
      await client.query(
        `INSERT INTO usage_counters (tenant_id, dimension, billing_period, total_quantity, updated_at)
         VALUES ($1,$2,$3,$4, NOW())
         ON CONFLICT (tenant_id, dimension, billing_period)
         DO UPDATE SET total_quantity = usage_counters.total_quantity + EXCLUDED.total_quantity, updated_at = NOW()`,
        [tenantId, dimension, billingPeriod, qty],
      )
    }

    await client.query('COMMIT')
    control.usage.processed++
    recordUsageMetric(dimension, plan, qty) // operational mirror for Grafana
    return { ok: true }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    control.usage.errors++
    throw e
  } finally {
    client.release()
  }
}
