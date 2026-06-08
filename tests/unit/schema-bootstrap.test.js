import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createReadiness, bootstrapSchema } from '@travelmanager/shared/schema-bootstrap'

describe('schema-bootstrap.createReadiness', () => {
  it('starts NotReady', () => {
    expect(createReadiness()).toEqual({ dbReady: false })
  })
})

describe('schema-bootstrap.bootstrapSchema', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flips readiness on first-try success', async () => {
    const readiness = createReadiness()
    const initFn = vi.fn().mockResolvedValue()
    const ok = await bootstrapSchema('test', initFn, { readiness })
    expect(ok).toBe(true)
    expect(readiness.dbReady).toBe(true)
    expect(initFn).toHaveBeenCalledTimes(1)
  })

  it('retries with backoff then succeeds', async () => {
    const readiness = createReadiness()
    const initFn = vi.fn()
      .mockRejectedValueOnce(new Error('db not up'))
      .mockRejectedValueOnce(new Error('db not up'))
      .mockResolvedValueOnce()
    const p = bootstrapSchema('test', initFn, { readiness, maxAttempts: 5 })
    await vi.runAllTimersAsync()
    expect(await p).toBe(true)
    expect(initFn).toHaveBeenCalledTimes(3)
    expect(readiness.dbReady).toBe(true)
  })

  it('returns false and stays NotReady after exhausting attempts', async () => {
    const readiness = createReadiness()
    const initFn = vi.fn().mockRejectedValue(new Error('never up'))
    const p = bootstrapSchema('test', initFn, { readiness, maxAttempts: 3 })
    await vi.runAllTimersAsync()
    expect(await p).toBe(false)
    expect(initFn).toHaveBeenCalledTimes(3)
    expect(readiness.dbReady).toBe(false)
  })
})
