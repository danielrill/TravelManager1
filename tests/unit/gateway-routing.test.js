import { describe, it, expect, afterEach } from 'vitest'
import { resolveService, serviceUrl, tenantServiceUrl, isPublic, isBlocked, featureGate } from '../../services/api-gateway/utils/routing.js'

describe('routing.resolveService', () => {
  it('maps path prefixes to service keys (first match wins)', () => {
    expect(resolveService('/api/users/123')).toBe('user')
    expect(resolveService('/api/tenants/acme')).toBe('user')
    expect(resolveService('/api/trips/all')).toBe('trip')
    expect(resolveService('/api/travel-plans/9')).toBe('trip')
    expect(resolveService('/api/destinations')).toBe('destination')
    expect(resolveService('/api/b2b/x')).toBe('destination')
    expect(resolveService('/api/feed')).toBe('social')
    expect(resolveService('/api/alerts')).toBe('travelInfo')
    expect(resolveService('/api/weather')).toBe('travelInfo')
  })

  it('returns null for unknown paths', () => {
    expect(resolveService('/api/unknown')).toBeNull()
    expect(resolveService('/healthz')).toBeNull()
  })
})

describe('routing.serviceUrl', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('falls back to localhost ports when env unset', () => {
    for (const k of ['USER_SERVICE_URL', 'TRIP_SERVICE_URL', 'DESTINATION_SERVICE_URL', 'SOCIAL_SERVICE_URL', 'TRAVEL_INFO_SERVICE_URL']) delete process.env[k]
    expect(serviceUrl('user')).toBe('http://localhost:3001')
    expect(serviceUrl('trip')).toBe('http://localhost:3002')
    expect(serviceUrl('destination')).toBe('http://localhost:3003')
    expect(serviceUrl('social')).toBe('http://localhost:3004')
    expect(serviceUrl('travelInfo')).toBe('http://localhost:3005')
  })

  it('reads the override env at runtime', () => {
    process.env.TRIP_SERVICE_URL = 'http://trip.internal:8080'
    expect(serviceUrl('trip')).toBe('http://trip.internal:8080')
  })

  it('returns null for an unknown service key', () => {
    expect(serviceUrl('bogus')).toBeNull()
  })
})

describe('routing.tenantServiceUrl', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('routes to the shared service when dedicated pods are disabled', () => {
    delete process.env.TENANT_DEDICATED_PODS
    for (const k of ['TRIP_SERVICE_URL', 'SOCIAL_SERVICE_URL', 'USER_SERVICE_URL']) delete process.env[k]
    expect(tenantServiceUrl('trip', 'acme')).toBe('http://localhost:3002')
    expect(tenantServiceUrl('social', 'acme')).toBe('http://localhost:3004')
  })

  it("routes the free 'default' tenant to the shared service even with pods enabled", () => {
    process.env.TENANT_DEDICATED_PODS = '1'
    delete process.env.TRIP_SERVICE_URL
    expect(tenantServiceUrl('trip', 'default')).toBe('http://localhost:3002')
    expect(tenantServiceUrl('trip', '')).toBe('http://localhost:3002')
  })

  it('dedicates only trip + social by default, shares the rest', () => {
    process.env.TENANT_DEDICATED_PODS = '1'
    delete process.env.TENANT_DEDICATED_SERVICES
    for (const k of ['USER_SERVICE_URL', 'DESTINATION_SERVICE_URL', 'TRAVEL_INFO_SERVICE_URL']) delete process.env[k]
    expect(tenantServiceUrl('trip', 'acme')).toBe('http://trip-service-acme:8080')
    expect(tenantServiceUrl('social', 'acme')).toBe('http://social-service-acme:8080')
    expect(tenantServiceUrl('user', 'acme')).toBe('http://localhost:3001')
    expect(tenantServiceUrl('destination', 'acme')).toBe('http://localhost:3003')
    expect(tenantServiceUrl('travelInfo', 'acme')).toBe('http://localhost:3005')
  })

  it('honours a custom TENANT_DEDICATED_SERVICES set', () => {
    process.env.TENANT_DEDICATED_PODS = '1'
    process.env.TENANT_DEDICATED_SERVICES = 'trip-service'
    delete process.env.SOCIAL_SERVICE_URL
    expect(tenantServiceUrl('trip', 'acme')).toBe('http://trip-service-acme:8080')
    expect(tenantServiceUrl('social', 'acme')).toBe('http://localhost:3004') // no longer dedicated
  })

  it('falls back to the shared service for keys outside SERVICE_NAMES', () => {
    process.env.TENANT_DEDICATED_PODS = '1'
    delete process.env.METERING_SERVICE_URL
    expect(tenantServiceUrl('metering', 'acme')).toBe('http://localhost:3007')
  })
})

describe('routing.isPublic', () => {
  it('marks the documented anonymous routes public', () => {
    expect(isPublic('/api/trips/all', 'GET')).toBe(true)
    expect(isPublic('/api/destinations', 'GET')).toBe(true)
    expect(isPublic('/api/destinations/5/routes', 'GET')).toBe(true)
    expect(isPublic('/api/tenants/acme', 'GET')).toBe(true) // white-label config
    expect(isPublic('/api/likes/trip/42', 'GET')).toBe(true)
  })

  it('keeps everything else private', () => {
    expect(isPublic('/api/trips', 'GET')).toBe(false)
    expect(isPublic('/api/feed', 'GET')).toBe(false)
    expect(isPublic('/api/tenants/acme', 'POST')).toBe(false) // mutation, not config read
    expect(isPublic('/api/likes/trip/42', 'POST')).toBe(false)
  })
})

describe('routing.isBlocked', () => {
  it('blocks internal-only endpoints at the public edge', () => {
    expect(isBlocked('/api/internal/active-trips')).toBe(true)
    expect(isBlocked('/api/plan-refs')).toBe(true)
  })

  it('allows public endpoints through', () => {
    expect(isBlocked('/api/trips')).toBe(false)
    expect(isBlocked('/api/feed')).toBe(false)
  })
})

describe('routing.featureGate', () => {
  it('gates the personalized feed read behind Standard+', () => {
    expect(featureGate('/api/feed', 'free')).toMatch(/Standard plan/)
    expect(featureGate('/api/feed', 'standard')).toBeNull()
    expect(featureGate('/api/feed', 'enterprise')).toBeNull()
  })

  it('ignores query strings when matching the feed path', () => {
    expect(featureGate('/api/feed?cursor=abc', 'free')).toMatch(/Standard plan/)
  })

  it('keeps the follow graph open on every plan', () => {
    expect(featureGate('/api/feed/follows', 'free')).toBeNull()
    expect(featureGate('/api/feed/follows/uid-1', 'free')).toBeNull()
  })

  it('gates b2b data behind Enterprise', () => {
    expect(featureGate('/api/b2b/destinations/1/travelers', 'free')).toMatch(/Enterprise plan/)
    expect(featureGate('/api/b2b/destinations/1/travelers', 'standard')).toMatch(/Enterprise plan/)
    expect(featureGate('/api/b2b/destinations/1/travelers', 'enterprise')).toBeNull()
  })

  it('allows ungated paths', () => {
    expect(featureGate('/api/trips', 'free')).toBeNull()
  })
})
