import { describe, it, expect, vi, beforeEach } from 'vitest'

// embedding.js calls the real Vertex AI embed() — mock the shared embed module
// so tests stay offline. toVectorLiteral is passed through to the real impl
// shape via our mock.
const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }))
vi.mock('@travelmanager/shared/embed', () => ({
  embed: embedMock,
  toVectorLiteral: (v) => (Array.isArray(v) && v.length ? `[${v.join(',')}]` : null),
}))

import { tripText, embedTrip, updateTripEmbedding } from '../../services/trip-service/utils/embedding.js'

beforeEach(() => embedMock.mockReset())

describe('embedding.tripText', () => {
  it('joins present fields with ". " and drops falsy ones', () => {
    const t = { title: 'Trek', destination: 'Alps', dest_country: null, short_description: 'Snow', detail_description: '' }
    expect(tripText(t)).toBe('Trek. Alps. Snow')
  })

  it('handles a trip with only a title', () => {
    expect(tripText({ title: 'Solo' })).toBe('Solo')
  })
})

describe('embedding.embedTrip', () => {
  it('returns a pgvector literal when embedding succeeds', async () => {
    embedMock.mockResolvedValue([0.1, 0.2])
    expect(await embedTrip({ title: 'X' })).toBe('[0.1,0.2]')
  })

  it('returns null when embedding is unavailable', async () => {
    embedMock.mockResolvedValue(null)
    expect(await embedTrip({ title: 'X' })).toBeNull()
  })
})

describe('embedding.updateTripEmbedding', () => {
  it('writes the embedding and returns true on success', async () => {
    embedMock.mockResolvedValue([1, 2, 3])
    const db = { query: vi.fn().mockResolvedValue({}) }
    const ok = await updateTripEmbedding(db, { id: 42, title: 'X' })
    expect(ok).toBe(true)
    expect(db.query).toHaveBeenCalledWith(
      'UPDATE trips SET embedding = $1::vector WHERE id = $2',
      ['[1,2,3]', 42],
    )
  })

  it('no-ops and returns false when no embedding', async () => {
    embedMock.mockResolvedValue(null)
    const db = { query: vi.fn() }
    expect(await updateTripEmbedding(db, { id: 42, title: 'X' })).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })
})
