import { describe, it, expect } from 'vitest'
import { getPlan, planAllows } from '@travelmanager/shared/tiers'

describe('tiers.getPlan', () => {
  it('returns the matching plan by id', () => {
    expect(getPlan('standard').id).toBe('standard')
    expect(getPlan('enterprise').id).toBe('enterprise')
  })

  it('falls back to the free plan for unknown/empty ids', () => {
    expect(getPlan('bogus').id).toBe('free')
    expect(getPlan(undefined).id).toBe('free')
    expect(getPlan('').id).toBe('free')
  })

  it('exposes the documented per-minute rate limits', () => {
    expect(getPlan('free').rateLimitPerMin).toBe(60)
    expect(getPlan('standard').rateLimitPerMin).toBe(600)
    expect(getPlan('enterprise').rateLimitPerMin).toBe(6000)
  })

  it('prices Standard as a one-time €29.99 setup, then usage-based (no recurring fee)', () => {
    expect(getPlan('standard').oneTimeSetupCents).toBe(2999)
    expect(getPlan('free').oneTimeSetupCents).toBeUndefined()
  })
})

describe('tiers.planAllows', () => {
  it('gates feed + newsletter behind Standard', () => {
    expect(planAllows('free', 'feed')).toBe(false)
    expect(planAllows('free', 'newsletter')).toBe(false)
    expect(planAllows('standard', 'feed')).toBe(true)
    expect(planAllows('standard', 'newsletter')).toBe(true)
  })

  it('gates b2bData behind Enterprise only', () => {
    expect(planAllows('free', 'b2bData')).toBe(false)
    expect(planAllows('standard', 'b2bData')).toBe(false)
    expect(planAllows('enterprise', 'b2bData')).toBe(true)
  })

  it('unknown plan inherits free permissions', () => {
    expect(planAllows('bogus', 'feed')).toBe(false)
  })

  it('unknown feature is denied', () => {
    expect(planAllows('enterprise', 'nope')).toBe(false)
  })
})
