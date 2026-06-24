import { describe, it, expect, vi, beforeEach } from 'vitest'

// meterApiRequest pulls the Redis client from shared/cache and delegates to
// shared/metering.bumpUsageCounter. Mock both so we can assert delegation and the
// fail-open guarantee (it must never throw into the gateway hot path).
const { getRedisMock, bumpMock } = vi.hoisted(() => ({ getRedisMock: vi.fn(), bumpMock: vi.fn() }))
vi.mock('@travelmanager/shared/cache', () => ({ getRedis: getRedisMock }))
vi.mock('@travelmanager/shared/metering', () => ({ bumpUsageCounter: bumpMock }))

import { meterApiRequest } from '../../services/api-gateway/utils/usage-meter.js'

beforeEach(() => {
  getRedisMock.mockReset()
  bumpMock.mockReset()
})

describe('usage-meter.meterApiRequest', () => {
  it('forwards the tenant + api_request dimension to bumpUsageCounter', () => {
    const redis = {}
    getRedisMock.mockReturnValue(redis)
    meterApiRequest('tui')
    expect(bumpMock).toHaveBeenCalledWith(redis, 'tui', 'api_request', 1)
  })

  it('never throws when getRedis throws (fail-open hot path)', () => {
    getRedisMock.mockImplementation(() => { throw new Error('redis init blew up') })
    expect(() => meterApiRequest('tui')).not.toThrow()
  })
})
