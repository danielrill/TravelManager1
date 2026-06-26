import { describe, it, expect, afterEach } from 'vitest'
import { dedicatedServices, appEnv, serviceAccountFor } from '../../services/provisioner-service/utils/k8s.js'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

const envMap = (id) => Object.fromEntries(appEnv(id).map((e) => [e.name, e.value]))

describe('provisioner.dedicatedServices', () => {
  it('defaults to the two DB-isolated services', () => {
    delete process.env.TENANT_DEDICATED_SERVICES
    expect(dedicatedServices()).toEqual(['trip-service', 'social-service'])
  })

  it('parses a custom comma list', () => {
    process.env.TENANT_DEDICATED_SERVICES = ' trip-service , social-service '
    expect(dedicatedServices()).toEqual(['trip-service', 'social-service'])
  })

  it('drops unknown services not in APP_SERVICES', () => {
    process.env.TENANT_DEDICATED_SERVICES = 'trip-service,bogus-service'
    expect(dedicatedServices()).toEqual(['trip-service'])
  })
})

describe('provisioner.appEnv service URLs', () => {
  it('suffixes only dedicated services; shared ones point at the shared Service', () => {
    delete process.env.TENANT_DEDICATED_SERVICES
    for (const k of ['USER_SERVICE_URL', 'DESTINATION_SERVICE_URL', 'TRAVEL_INFO_SERVICE_URL']) delete process.env[k]
    const env = envMap('acme')
    expect(env.TRIP_SERVICE_URL).toBe('http://trip-service-acme:8080')
    expect(env.SOCIAL_SERVICE_URL).toBe('http://social-service-acme:8080')
    expect(env.USER_SERVICE_URL).toBe('http://user-service:8080')
    expect(env.DESTINATION_SERVICE_URL).toBe('http://destination-service:8080')
    expect(env.TRAVEL_INFO_SERVICE_URL).toBe('http://travel-info-service:8080')
  })

  it('uses the provisioner shared *_SERVICE_URL env when set', () => {
    delete process.env.TENANT_DEDICATED_SERVICES
    process.env.USER_SERVICE_URL = 'http://user-service.svc:8080'
    expect(envMap('acme').USER_SERVICE_URL).toBe('http://user-service.svc:8080')
  })

  it('never suffixes a non-dedicated service with the tenant id', () => {
    process.env.TENANT_DEDICATED_SERVICES = 'trip-service'
    const env = envMap('acme')
    expect(env.TRIP_SERVICE_URL).toBe('http://trip-service-acme:8080')
    expect(env.SOCIAL_SERVICE_URL).not.toContain('-acme')
  })
})

describe('provisioner.serviceAccountFor', () => {
  it('defaults to the shared travelmanager KSA when the flag is off', () => {
    delete process.env.TENANT_PER_SERVICE_SA
    expect(serviceAccountFor('trip-service')).toBe('travelmanager')
    expect(serviceAccountFor('social-service')).toBe('travelmanager')
  })

  it('derives <svc>-sa per service when the flag is on', () => {
    process.env.TENANT_PER_SERVICE_SA = '1'
    expect(serviceAccountFor('trip-service')).toBe('trip-sa')
    expect(serviceAccountFor('social-service')).toBe('social-sa')
  })

  it('honours the TENANT_SERVICE_SA_MAP override', () => {
    process.env.TENANT_PER_SERVICE_SA = '1'
    process.env.TENANT_SERVICE_SA_MAP = ' trip-service = trip-mesh-sa , social-service=social-sa '
    expect(serviceAccountFor('trip-service')).toBe('trip-mesh-sa')
    expect(serviceAccountFor('social-service')).toBe('social-sa')
  })

  it('override is ignored while the flag is off', () => {
    delete process.env.TENANT_PER_SERVICE_SA
    process.env.TENANT_SERVICE_SA_MAP = 'trip-service=trip-mesh-sa'
    expect(serviceAccountFor('trip-service')).toBe('travelmanager')
  })
})
