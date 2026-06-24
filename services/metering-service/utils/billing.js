// Billing read model: load rate cards, read usage counters, project cost.
// Pure-cost math lives in @travelmanager/shared/rating; this file is the DB glue.
import { getDb } from '@travelmanager/shared/db'
import { currentPeriod } from '@travelmanager/shared/metering'
import { computeCost, resolveRateCard } from '@travelmanager/shared/rating'

// Latest-effective plan card: for each dimension pick the row with the greatest
// effective_from that is already in effect (<= now), so a future-dated rate change
// doesn't apply early and historical periods stay stable.
export async function loadPlanCard(plan, db = getDb()) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (dimension) dimension, included_qty, unit_rate_cents, base_fee_cents
       FROM rate_cards
      WHERE plan = $1 AND effective_from <= NOW()
      ORDER BY dimension, effective_from DESC`,
    [plan],
  )
  const card = {}
  for (const r of rows) {
    card[r.dimension] = {
      includedQty: Number(r.included_qty),
      unitRateCents: Number(r.unit_rate_cents),
      baseFeeCents: Number(r.base_fee_cents),
    }
  }
  return card
}

export async function loadOverrides(tenantId, db = getDb()) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (dimension) dimension, included_qty, unit_rate_cents
       FROM tenant_rate_overrides
      WHERE tenant_id = $1 AND effective_from <= NOW()
      ORDER BY dimension, effective_from DESC`,
    [tenantId],
  )
  const ov = {}
  for (const r of rows) {
    ov[r.dimension] = {
      includedQty: r.included_qty != null ? Number(r.included_qty) : null,
      unitRateCents: r.unit_rate_cents != null ? Number(r.unit_rate_cents) : null,
    }
  }
  return ov
}

// Usage totals for a tenant in a period → { dimension: total }.
export async function loadUsage(tenantId, period = currentPeriod(), db = getDb()) {
  const { rows } = await db.query(
    `SELECT dimension, total_quantity FROM usage_counters
      WHERE tenant_id = $1 AND billing_period = $2`,
    [tenantId, period],
  )
  const usage = {}
  for (const r of rows) usage[r.dimension] = Number(r.total_quantity)
  return usage
}

// Full projection for a tenant/plan/period: resolved card + usage + computed cost.
export async function projectCost(tenantId, plan, period = currentPeriod(), db = getDb()) {
  const [planCard, overrides, usage] = await Promise.all([
    loadPlanCard(plan, db),
    loadOverrides(tenantId, db),
    loadUsage(tenantId, period, db),
  ])
  const card = resolveRateCard(planCard, overrides)
  const { totalCents, lines } = computeCost(usage, card)
  return { tenantId, plan, billingPeriod: period, totalCents, lines, usage }
}
