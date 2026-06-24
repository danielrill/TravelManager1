import { describe, it, expect } from 'vitest'
import { computeCost, resolveRateCard, lineCostCents, isDimension, DIMENSIONS } from '@travelmanager/shared/rating'

describe('rating.lineCostCents', () => {
  it('charges base fee only when usage is within the included quota', () => {
    expect(lineCostCents(50, { includedQty: 100, unitRateCents: 2, baseFeeCents: 4900 })).toBe(4900)
  })
  it('charges base + overage * unit rate beyond the included quota', () => {
    // 30 over * 2c = 60c, + 4900 base = 4960
    expect(lineCostCents(130, { includedQty: 100, unitRateCents: 2, baseFeeCents: 4900 })).toBe(4960)
  })
  it('treats a missing line as free', () => {
    expect(lineCostCents(1000, undefined)).toBe(0)
  })
})

describe('rating.resolveRateCard', () => {
  const plan = {
    api_request: { includedQty: 1000, unitRateCents: 1, baseFeeCents: 5000 },
    trip_created: { includedQty: 10, unitRateCents: 100, baseFeeCents: 0 },
  }
  it('returns the plan card unchanged with no overrides', () => {
    const card = resolveRateCard(plan, {})
    expect(card.api_request.unitRateCents).toBe(1)
    expect(card.trip_created.includedQty).toBe(10)
  })
  it('layers a per-tenant negotiated rate over the plan, field by field', () => {
    const card = resolveRateCard(plan, { api_request: { unitRateCents: 0.5 } })
    expect(card.api_request.unitRateCents).toBe(0.5)   // overridden
    expect(card.api_request.includedQty).toBe(1000)    // inherited
    expect(card.api_request.baseFeeCents).toBe(5000)   // inherited
  })
  it('a null override field inherits the plan value', () => {
    const card = resolveRateCard(plan, { trip_created: { includedQty: null, unitRateCents: 50 } })
    expect(card.trip_created.includedQty).toBe(10)
    expect(card.trip_created.unitRateCents).toBe(50)
  })
})

describe('rating.computeCost', () => {
  const card = {
    api_request: { includedQty: 1000, unitRateCents: 0.01, baseFeeCents: 4900 },
    ai_recommendation: { includedQty: 100, unitRateCents: 2, baseFeeCents: 0 },
    active_seat: { includedQty: 5, unitRateCents: 500, baseFeeCents: 0 },
    trip_created: { includedQty: 10, unitRateCents: 1, baseFeeCents: 0 },
  }
  it('sums base fees + overage across all dimensions', () => {
    const usage = { api_request: 3000, ai_recommendation: 150, active_seat: 8, trip_created: 5 }
    // api: 4900 + 2000*0.01=20 -> 4920; ai: 50*2=100; seat: 3*500=1500; trip: within -> 0
    const { totalCents, lines } = computeCost(usage, card)
    expect(totalCents).toBe(4920 + 100 + 1500 + 0)
    const seat = lines.find((l) => l.dimension === 'active_seat')
    expect(seat.overage).toBe(3)
    expect(seat.costCents).toBe(1500)
  })
  it('still bills a base fee at zero usage', () => {
    const { totalCents } = computeCost({}, { api_request: { includedQty: 1000, unitRateCents: 1, baseFeeCents: 4900 } })
    expect(totalCents).toBe(4900)
  })
  it('surfaces a used dimension not in the card as free', () => {
    const { lines, totalCents } = computeCost({ trip_created: 99 }, {})
    expect(totalCents).toBe(0)
    expect(lines[0].dimension).toBe('trip_created')
    expect(lines[0].costCents).toBe(0)
  })
})

describe('rating.isDimension', () => {
  it('accepts the four metered dimensions', () => {
    for (const d of ['api_request', 'ai_recommendation', 'active_seat', 'trip_created']) {
      expect(isDimension(d)).toBe(true)
    }
    expect(DIMENSIONS).toHaveLength(4)
  })
  it('rejects unknown dimensions', () => {
    expect(isDimension('bogus')).toBe(false)
  })
})
