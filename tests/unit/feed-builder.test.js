import { describe, it, expect, vi, beforeEach } from 'vitest'

// buildFeedFromTrip fans a trip event out to every follower via getDb().
const { dbQuery } = vi.hoisted(() => ({ dbQuery: vi.fn() }))
vi.mock('@travelmanager/shared/db', () => ({ getDb: () => ({ query: dbQuery }) }))

async function load() {
  vi.resetModules()
  const mod = await import('../../services/social-service/utils/feed.js')
  const { control } = await import('../../services/social-service/utils/control.js')
  return { ...mod, control }
}

const payload = { tripId: 9, userUid: 'author', authorName: 'Bob', title: 'Alps', destination: 'Innsbruck', startDate: '2026-07-01' }

beforeEach(() => dbQuery.mockReset())

describe('feed.buildFeedFromTrip', () => {
  it('writes one feed entry per follower and returns the count', async () => {
    dbQuery
      .mockResolvedValueOnce({ rows: [{ follower_uid: 'f1' }, { follower_uid: 'f2' }] }) // followers
      .mockResolvedValue({ rowCount: 1 }) // each insert
    const { buildFeedFromTrip, control } = await load()
    expect(await buildFeedFromTrip(payload)).toBe(2)
    // 1 follower SELECT + 2 inserts
    expect(dbQuery).toHaveBeenCalledTimes(3)
    expect(control.feed.processed).toBe(1)
    // insert carries a numeric relevance score
    const insertArgs = dbQuery.mock.calls[1][1]
    expect(typeof insertArgs[6]).toBe('number')
  })

  it('returns 0 without querying for a payload missing ids', async () => {
    const { buildFeedFromTrip } = await load()
    expect(await buildFeedFromTrip({ tripId: null, userUid: 'x' })).toBe(0)
    expect(dbQuery).not.toHaveBeenCalled()
  })

  it('returns 0 when the author has no followers', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] })
    const { buildFeedFromTrip } = await load()
    expect(await buildFeedFromTrip(payload)).toBe(0)
    expect(dbQuery).toHaveBeenCalledTimes(1) // only the follower SELECT
  })
})
