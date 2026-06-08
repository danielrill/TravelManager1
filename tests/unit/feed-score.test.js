import { describe, it, expect } from 'vitest'
import { score } from '../../services/social-service/utils/feed.js'

const DAY = 86400000
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString()

describe('feed.score', () => {
  it('gives the max recency bonus to a trip starting now', () => {
    expect(score(inDays(0))).toBeCloseTo(2, 1)
  })

  it('decays linearly toward the base over 30 days', () => {
    expect(score(inDays(15))).toBeCloseTo(1.5, 1)
    expect(score(inDays(30))).toBeCloseTo(1.0, 2)
  })

  it('floors at the base 1.0 for trips beyond the 30-day window', () => {
    expect(score(inDays(60))).toBe(1)
  })

  it('treats past start dates as max recency (days clamp at 0)', () => {
    expect(score(inDays(-10))).toBeCloseTo(2, 1)
  })

  it('returns the base 1.0 for missing/unparseable dates', () => {
    expect(score(undefined)).toBe(1)
    expect(score('not-a-date')).toBe(1)
  })
})
