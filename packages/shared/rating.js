// Pure usage-based pricing engine. NO I/O — given a tenant's usage totals and a
// resolved rate card, it computes the period cost. Kept side-effect-free so it's
// trivially unit-testable and reusable by the metering-service (projections,
// invoices) and any admin tooling.
//
// Pricing model (per billing period):
//   cost = Σ_dimension [ base_fee + max(0, used - included) * unit_rate ]
// All money is in CENTS (integers in / fractional out only at the unit-rate
// multiply) to avoid float drift on the included/overage split.
//
// A "rate card" is the per-dimension price book for a plan. A tenant may carry
// per-dimension OVERRIDES (enterprise-negotiated rates); resolveRateCard layers
// overrides on top of the plan card, field-by-field (a null override field
// inherits the plan value).

// The dimensions we meter + bill on. Single source of truth for validation.
export const DIMENSIONS = ['api_request', 'ai_recommendation', 'active_seat', 'trip_created']

export function isDimension(d) {
  return DIMENSIONS.includes(d)
}

// Normalise one rate-card line. Defaults make an absent line free (0 included,
// 0 rate, 0 base) so a missing dimension never throws — it just costs nothing.
function normLine(line = {}) {
  return {
    includedQty: Number(line.includedQty ?? 0),
    unitRateCents: Number(line.unitRateCents ?? 0),
    baseFeeCents: Number(line.baseFeeCents ?? 0),
  }
}

// Layer a tenant's per-dimension overrides on top of the plan card. Each override
// field is applied only when non-null/defined, so a partial override (e.g. just a
// negotiated unit rate) keeps the plan's included quota + base fee.
//   planCard:  { [dimension]: { includedQty, unitRateCents, baseFeeCents } }
//   overrides: { [dimension]: { includedQty?, unitRateCents? } }  (nulls inherit)
export function resolveRateCard(planCard = {}, overrides = {}) {
  const out = {}
  const dims = new Set([...Object.keys(planCard), ...Object.keys(overrides)])
  for (const d of dims) {
    const base = normLine(planCard[d])
    const ov = overrides[d] || {}
    out[d] = {
      includedQty: ov.includedQty != null ? Number(ov.includedQty) : base.includedQty,
      unitRateCents: ov.unitRateCents != null ? Number(ov.unitRateCents) : base.unitRateCents,
      baseFeeCents: ov.baseFeeCents != null ? Number(ov.baseFeeCents) : base.baseFeeCents,
    }
  }
  return out
}

// Cost for a single dimension given its used quantity and resolved line.
export function lineCostCents(used, line) {
  const l = normLine(line)
  const overage = Math.max(0, Number(used || 0) - l.includedQty)
  return l.baseFeeCents + overage * l.unitRateCents
}

// Compute the full bill for a period.
//   usageByDimension: { [dimension]: usedQty }
//   rateCard:         resolved card { [dimension]: line }
// Returns { totalCents, lines: [{ dimension, used, included, overage, unitRateCents, baseFeeCents, costCents }] }.
//
// Money handling: unit rates are sub-cent (NUMERIC(12,4) in the rate card, e.g.
// 0.005¢/api_request) so a dimension's raw cost is fractional. We round EACH line
// to the nearest whole cent and sum the rounded lines, so (a) the persisted
// invoice total is an exact integer that fits `invoices.total_cents BIGINT`
// without truncation, (b) Σ lines === totalCents (itemisation reconciles to the
// bill), and (c) the real-time projection and the month-end invoice agree because
// both call this same function. `rawCostCents` keeps the un-rounded value for
// transparency/audit.
export function computeCost(usageByDimension = {}, rateCard = {}) {
  const lines = []
  let totalCents = 0
  // Bill every dimension priced in the card (a base fee applies even at 0 usage),
  // plus any used dimension not in the card (free — surfaced for transparency).
  const dims = new Set([...Object.keys(rateCard), ...Object.keys(usageByDimension)])
  for (const d of dims) {
    const line = normLine(rateCard[d])
    const used = Number(usageByDimension[d] || 0)
    const overage = Math.max(0, used - line.includedQty)
    const rawCostCents = line.baseFeeCents + overage * line.unitRateCents
    const costCents = Math.round(rawCostCents)
    totalCents += costCents
    lines.push({
      dimension: d,
      used,
      included: line.includedQty,
      overage,
      unitRateCents: line.unitRateCents,
      baseFeeCents: line.baseFeeCents,
      rawCostCents,
      costCents,
    })
  }
  lines.sort((a, b) => a.dimension.localeCompare(b.dimension))
  return { totalCents, lines }
}
