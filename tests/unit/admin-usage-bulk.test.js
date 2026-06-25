import { describe, it, expect } from 'vitest'
import { shapeBulk } from '../../services/metering-service/utils/bulk-usage.js'

const TENANTS = [
  { id: 'tui', name: 'TUI Group', subdomain: 'tui', plan: 'standard' },
  { id: 'acme', name: 'Acme', subdomain: 'acme', plan: 'enterprise' },
]

describe('shapeBulk', () => {
  it('merges roster name/subdomain onto each projection and sums the total', () => {
    const projections = [
      { tenantId: 'tui', totalCents: 4900, lines: [{ dimension: 'api_request' }], usage: { api_request: 10 } },
      { tenantId: 'acme', totalCents: 12500, lines: [], usage: {} },
    ]
    const out = shapeBulk(TENANTS, projections, '2026-06')

    expect(out.billingPeriod).toBe('2026-06')
    expect(out.totalCents).toBe(17400)
    expect(out.tenants).toHaveLength(2)

    const tui = out.tenants.find((t) => t.tenantId === 'tui')
    expect(tui).toMatchObject({ name: 'TUI Group', subdomain: 'tui', plan: 'standard', totalCents: 4900 })
    expect(tui.lines).toEqual([{ dimension: 'api_request' }])
    expect(tui.usage).toEqual({ api_request: 10 })
  })

  it('defaults a tenant with no projection to zero cost', () => {
    const out = shapeBulk(TENANTS, [], '2026-06')
    expect(out.totalCents).toBe(0)
    expect(out.tenants).toHaveLength(2)
    expect(out.tenants[0]).toMatchObject({ totalCents: 0, lines: [], usage: {} })
  })

  it('keeps subdomain null when the roster row has none', () => {
    const out = shapeBulk([{ id: 'x', name: 'X', plan: 'standard' }], [], '2026-06')
    expect(out.tenants[0].subdomain).toBeNull()
  })
})
