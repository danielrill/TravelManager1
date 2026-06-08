import { describe, it, expect } from 'vitest'
import { toVectorLiteral } from '@travelmanager/shared/embed'

describe('embed.toVectorLiteral', () => {
  it('formats a number array as a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
    expect(toVectorLiteral([1])).toBe('[1]')
  })

  it('returns null for empty input so callers store SQL NULL', () => {
    expect(toVectorLiteral([])).toBeNull()
  })

  it('returns null for non-array input', () => {
    expect(toVectorLiteral(null)).toBeNull()
    expect(toVectorLiteral(undefined)).toBeNull()
    expect(toVectorLiteral('nope')).toBeNull()
  })
})
