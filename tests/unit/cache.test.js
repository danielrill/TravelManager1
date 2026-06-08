import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// cache.js lazily constructs one ioredis client from REDIS_URL and caches it in
// module state. Mock the ioredis ctor to return a programmable fake, and reload
// the module per scenario so the singleton + _disabled flag reset.
const { fakeRedis } = vi.hoisted(() => ({
  fakeRedis: {
    get: vi.fn(),
    set: vi.fn(() => Promise.resolve()),
    del: vi.fn(() => Promise.resolve(1)),
    scanStream: vi.fn(),
    on: vi.fn(),
    connect: vi.fn(() => Promise.resolve()),
  },
}))
// ioredis is invoked via `new Redis(url)` — the mock must be constructable, so
// use a class whose constructor returns the shared fake (vitest v4 rejects arrow
// fns used with `new`).
vi.mock('ioredis', () => ({ default: class { constructor() { return fakeRedis } } }))

const savedEnv = { ...process.env }

async function load(withRedis) {
  vi.resetModules()
  process.env = { ...savedEnv }
  if (withRedis) process.env.REDIS_URL = 'redis://fake:6379'
  else delete process.env.REDIS_URL
  return import('@travelmanager/shared/cache')
}

beforeEach(() => {
  fakeRedis.get.mockReset()
  fakeRedis.set.mockReset().mockReturnValue(Promise.resolve())
  fakeRedis.del.mockReset().mockReturnValue(Promise.resolve(1))
  fakeRedis.scanStream.mockReset()
  fakeRedis.on.mockReset()
  fakeRedis.connect.mockReset().mockReturnValue(Promise.resolve())
})
afterEach(() => { process.env = { ...savedEnv } })

describe('cache.getRedis', () => {
  it('returns null and disables when REDIS_URL is unset', async () => {
    const { getRedis } = await load(false)
    expect(getRedis()).toBeNull()
  })

  it('returns a single shared client when configured', async () => {
    const { getRedis } = await load(true)
    expect(getRedis()).toBe(fakeRedis)
    expect(getRedis()).toBe(fakeRedis) // memoised
  })

  it('registers Redis event handlers and starts lazy connection', async () => {
    const { getRedis } = await load(true)
    getRedis()
    expect(fakeRedis.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(fakeRedis.on).toHaveBeenCalledWith('ready', expect.any(Function))
    expect(fakeRedis.connect).toHaveBeenCalledOnce()
  })

  it('logs only the first Redis error until ready fires', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getRedis } = await load(true)
    getRedis()
    const errorHandler = fakeRedis.on.mock.calls.find(c => c[0] === 'error')[1]
    const readyHandler = fakeRedis.on.mock.calls.find(c => c[0] === 'ready')[1]

    errorHandler(new Error('first'))
    errorHandler(new Error('second'))
    readyHandler()
    errorHandler(new Error('third'))

    expect(errorSpy).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })
})

describe('cache.cached', () => {
  it('runs the loader directly when Redis is disabled (fail open)', async () => {
    const { cached } = await load(false)
    const loader = vi.fn().mockResolvedValue({ v: 1 })
    expect(await cached('k', 60, loader)).toEqual({ v: 1 })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('returns the parsed cached value on hit (no loader call)', async () => {
    const { cached } = await load(true)
    fakeRedis.get.mockResolvedValue(JSON.stringify({ v: 2 }))
    const loader = vi.fn()
    expect(await cached('k', 60, loader)).toEqual({ v: 2 })
    expect(loader).not.toHaveBeenCalled()
  })

  it('runs the loader and caches on miss', async () => {
    const { cached } = await load(true)
    fakeRedis.get.mockResolvedValue(null)
    const loader = vi.fn().mockResolvedValue({ v: 3 })
    expect(await cached('k', 30, loader)).toEqual({ v: 3 })
    expect(fakeRedis.set).toHaveBeenCalledWith('k', JSON.stringify({ v: 3 }), 'EX', 30)
  })

  it('does not cache null loader results', async () => {
    const { cached } = await load(true)
    fakeRedis.get.mockResolvedValue(null)
    expect(await cached('k', 30, vi.fn().mockResolvedValue(null))).toBeNull()
    expect(fakeRedis.set).not.toHaveBeenCalled()
  })

  it('falls through to the loader when the Redis read throws', async () => {
    const { cached } = await load(true)
    fakeRedis.get.mockRejectedValue(new Error('conn reset'))
    const loader = vi.fn().mockResolvedValue({ v: 4 })
    expect(await cached('k', 60, loader)).toEqual({ v: 4 })
  })
})

describe('cache.invalidate', () => {
  it('no-ops on empty key list', async () => {
    const { invalidate } = await load(true)
    await invalidate()
    expect(fakeRedis.del).not.toHaveBeenCalled()
  })

  it('deletes the given keys', async () => {
    const { invalidate } = await load(true)
    await invalidate('a', 'b')
    expect(fakeRedis.del).toHaveBeenCalledWith('a', 'b')
  })

  it('swallows delete errors', async () => {
    const { invalidate } = await load(true)
    fakeRedis.del.mockRejectedValue(new Error('redis down'))
    await expect(invalidate('a')).resolves.toBeUndefined()
  })

  it('is a no-op when Redis is disabled', async () => {
    const { invalidate } = await load(false)
    await invalidate('a')
    expect(fakeRedis.del).not.toHaveBeenCalled()
  })
})

describe('cache.invalidatePattern', () => {
  it('SCANs and deletes matching batches', async () => {
    const { invalidatePattern } = await load(true)
    fakeRedis.scanStream.mockReturnValue((async function* () { yield ['p:1', 'p:2'] })())
    await invalidatePattern('p:')
    expect(fakeRedis.scanStream).toHaveBeenCalledWith({ match: 'p:*', count: 100 })
    expect(fakeRedis.del).toHaveBeenCalledWith('p:1', 'p:2')
  })

  it('skips empty SCAN batches', async () => {
    const { invalidatePattern } = await load(true)
    fakeRedis.scanStream.mockReturnValue((async function* () { yield [] })())
    await invalidatePattern('p:')
    expect(fakeRedis.del).not.toHaveBeenCalled()
  })

  it('swallows SCAN errors', async () => {
    const { invalidatePattern } = await load(true)
    fakeRedis.scanStream.mockReturnValue((async function* () { throw new Error('scan failed') })())
    await expect(invalidatePattern('p:')).resolves.toBeUndefined()
  })
})
