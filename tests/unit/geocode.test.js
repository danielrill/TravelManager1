import { describe, it, expect } from 'vitest'
import { primaryPlace } from '@travelmanager/shared/geocode'

describe('geocode.primaryPlace', () => {
  it('returns the first place from a list', () => {
    expect(primaryPlace('Vienna & Salzburg')).toBe('Vienna')
    expect(primaryPlace('Paris, Lyon')).toBe('Paris')
    expect(primaryPlace('Rome / Naples')).toBe('Rome')
    expect(primaryPlace('Berlin und München')).toBe('Berlin')
    expect(primaryPlace('London and Bath')).toBe('London')
  })

  it('trims surrounding whitespace', () => {
    expect(primaryPlace('  Tokyo  ')).toBe('Tokyo')
  })

  it('returns a single place unchanged', () => {
    expect(primaryPlace('Madrid')).toBe('Madrid')
  })

  it('returns empty string for falsy input', () => {
    expect(primaryPlace('')).toBe('')
    expect(primaryPlace(null)).toBe('')
    expect(primaryPlace(undefined)).toBe('')
  })
})
