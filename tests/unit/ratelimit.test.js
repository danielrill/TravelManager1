import { describe, it, expect, vi, beforeEach } from 'vitest'

// allow() backs onto the shared Redis client via getRedis. Mock it so we can
// drive the Lua eval result (and the fail-open path) without a real Redis.
const { getRedisMock } = vi.hoisted(() => ({ getRedisMock: vi.fn() }))
vi.mock('@travelmanager/shared/cache', () => ({ getRedis: getRedisMock }))

import { allow } from '../../services/api-gateway/utils/ratelimit.js'

beforeEach(() => getRedisMock.mockReset())

describe('ratelimit.allow', () => {
  it('fails open (allows) when Redis is disabled', async () => {
    getRedisMock.mockReturnValue(null)
    expect(await allow('uid-1', 60)).toBe(true)
  })

  it('allows when the bucket script returns 1', async () => {
    getRedisMock.mockReturnValue({ eval: vi.fn().mockResolvedValue(1) })
    expect(await allow('uid-1', 600)).toBe(true)
  })

  it('denies when the bucket script returns 0', async () => {
    getRedisMock.mockReturnValue({ eval: vi.fn().mockResolvedValue(0) })
    expect(await allow('uid-1', 60)).toBe(false)
  })

  it('fails open when the Redis eval throws (limiter must never block traffic)', async () => {
    getRedisMock.mockReturnValue({ eval: vi.fn().mockRejectedValue(new Error('NOSCRIPT')) })
    expect(await allow('uid-1', 60)).toBe(true)
  })

  it('keys the bucket as rl:<key> with capacity + ttl args', async () => {
    const evalFn = vi.fn().mockResolvedValue(1)
    getRedisMock.mockReturnValue({ eval: evalFn })
    await allow('uid-9', 600)
    const [, numKeys, key, cap, ttl] = evalFn.mock.calls[0]
    expect(numKeys).toBe(1)
    expect(key).toBe('rl:uid-9')
    expect(cap).toBe(600)
    expect(ttl).toBe(120)
  })
})
