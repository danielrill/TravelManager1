import { describe, it, expect } from 'vitest'
import { traceHeaders, PROPAGATED_TRACE_HEADERS } from '@travelmanager/shared/trace'

// Build a fake h3 event carrying the given inbound request headers.
const ev = (headers) => ({ node: { req: { headers } } })

describe('trace.traceHeaders', () => {
  it('extracts the full Istio/Envoy + W3C + Cloud Trace propagation set', () => {
    const out = traceHeaders(ev({
      'x-request-id': 'req-1',
      'x-b3-traceid': 'abc',
      'x-b3-spanid': 'def',
      'x-b3-sampled': '1',
      traceparent: '00-trace-span-01',
      tracestate: 'vendor=1',
      'x-cloud-trace-context': 'TRACE/SPAN;o=1',
    }))
    expect(out).toEqual({
      'x-request-id': 'req-1',
      'x-b3-traceid': 'abc',
      'x-b3-spanid': 'def',
      'x-b3-sampled': '1',
      traceparent: '00-trace-span-01',
      tracestate: 'vendor=1',
      'x-cloud-trace-context': 'TRACE/SPAN;o=1',
    })
  })

  it('ignores non-trace headers (only forwards the allowlist)', () => {
    const out = traceHeaders(ev({
      'x-tenant-id': 'tui',
      authorization: 'Bearer secret',
      cookie: 'session=x',
      traceparent: '00-t-s-01',
    }))
    expect(out).toEqual({ traceparent: '00-t-s-01' })
    expect(out).not.toHaveProperty('x-tenant-id')
    expect(out).not.toHaveProperty('authorization')
  })

  it('returns {} for a null/empty event (background/cron callers, no inbound trace)', () => {
    expect(traceHeaders(undefined)).toEqual({})
    expect(traceHeaders(null)).toEqual({})
    expect(traceHeaders({})).toEqual({})
    expect(traceHeaders(ev(undefined))).toEqual({})
    expect(traceHeaders(ev({}))).toEqual({})
  })

  it('collapses array-valued headers to a comma string (safe to spread into fetch)', () => {
    const out = traceHeaders(ev({ tracestate: ['a=1', 'b=2'] }))
    expect(out.tracestate).toBe('a=1,b=2')
  })

  it('exposes the propagated header list', () => {
    expect(PROPAGATED_TRACE_HEADERS).toContain('traceparent')
    expect(PROPAGATED_TRACE_HEADERS).toContain('x-b3-traceid')
    expect(PROPAGATED_TRACE_HEADERS).toContain('x-cloud-trace-context')
  })
})
