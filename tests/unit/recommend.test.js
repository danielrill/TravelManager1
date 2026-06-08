import { describe, it, expect, vi, beforeEach } from 'vitest'

// recommendForUser takes the db as a param (easy to fake) but reaches Firestore
// for liked-trip ids — mock the shared firebase accessor.
const { firestoreMock } = vi.hoisted(() => ({ firestoreMock: vi.fn() }))
vi.mock('@travelmanager/shared/firebase', () => ({ getFirestoreDb: firestoreMock }))

import { recommendForUser } from '../../services/trip-service/utils/recommend.js'

// Firestore chain stub: collectionGroup().where().get() → { docs }
function stubFirestore(likedIds = []) {
  const docs = likedIds.map(id => ({ ref: { parent: { parent: { id: String(id) } } } }))
  firestoreMock.mockReturnValue({
    collectionGroup: () => ({ where: () => ({ get: () => Promise.resolve({ docs }) }) }),
  })
}

// Route fake db queries by SQL fragment.
function fakeDb(handlers) {
  return {
    query: vi.fn(async (sql) => {
      for (const [frag, rows] of handlers) {
        if (sql.includes(frag)) {
          if (rows instanceof Error) throw rows
          return { rows }
        }
      }
      return { rows: [] }
    }),
  }
}

beforeEach(() => firestoreMock.mockReset())

describe('recommend.recommendForUser', () => {
  it('uses the popularity fallback for anonymous users', async () => {
    const db = fakeDb([['ORDER BY like_count', [{ id: 1, like_count: 5 }, { id: 2, like_count: 0 }]]])
    const out = await recommendForUser(db, null)
    expect(out.map(r => r.reason)).toEqual(['popular', 'new'])
  })

  it('falls back to popularity when the user has no taste signal', async () => {
    stubFirestore([])
    const db = fakeDb([
      ['user_uid = $1', []],            // no own trips
      ['ORDER BY like_count', [{ id: 9, like_count: 3 }]],
    ])
    const out = await recommendForUser(db, 'u1')
    expect(out[0].reason).toBe('popular')
  })

  it('returns semantic "foryou" results when embeddings exist', async () => {
    stubFirestore([2])
    const db = fakeDb([
      ['user_uid = $1', [{ id: 1 }]],
      ['avg(embedding)', [{ taste: '[0.1,0.2]' }]],
      ['embedding <=>', [{ id: 7, like_count: 1 }, { id: 8, like_count: 0 }]],
    ])
    const out = await recommendForUser(db, 'u1')
    expect(out.every(r => r.reason === 'foryou')).toBe(true)
    expect(out.map(r => r.id)).toEqual([7, 8])
  })

  it('falls back to popularity when no embeddings are present (null taste)', async () => {
    stubFirestore([])
    const db = fakeDb([
      ['user_uid = $1', [{ id: 1 }]],
      ['avg(embedding)', [{ taste: null }]],
      ['ORDER BY like_count', [{ id: 5, like_count: 2 }]],
    ])
    const out = await recommendForUser(db, 'u1')
    expect(out[0].reason).toBe('popular')
  })

  it('never throws — vector query error degrades to popularity', async () => {
    stubFirestore([])
    const db = fakeDb([
      ['user_uid = $1', [{ id: 1 }]],
      ['avg(embedding)', new Error('pgvector missing')],
      ['ORDER BY like_count', [{ id: 3, like_count: 0 }]],
    ])
    const out = await recommendForUser(db, 'u1')
    expect(out[0].reason).toBe('new')
  })
})
