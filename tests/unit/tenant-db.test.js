import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { poolForTenant, tenantConnString, tenantDb } from '../../packages/shared/tenant-db.js'
import { getDb } from '../../packages/shared/db.js'

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV } })
beforeEach(() => { process.env = { ...ENV } })

describe('poolForTenant', () => {
  it('routes the default/free tenant to the shared pool', () => {
    expect(poolForTenant('default')).toBe(getDb())
    expect(poolForTenant('')).toBe(getDb())
    expect(poolForTenant(undefined)).toBe(getDb())
  })

  it('rejects an invalid tenant id (no host/SQL injection)', () => {
    expect(() => poolForTenant('Bad Id')).toThrow()
    expect(() => poolForTenant('a; DROP')).toThrow()
    expect(() => poolForTenant('UPPER')).toThrow()
  })
})

describe('tenantDb', () => {
  it('reads tenantId from event.context.user, then context, else default', () => {
    expect(tenantDb({ context: { user: { tenantId: 'default' } } })).toBe(getDb())
    expect(tenantDb({ context: { tenantId: 'default' } })).toBe(getDb())
    expect(tenantDb({ context: {} })).toBe(getDb())
  })
})

describe('tenantConnString', () => {
  it('builds a per-tenant pod connection string from the convention + env', () => {
    process.env.TENANT_DB_USER = 'tmuser'
    process.env.TENANT_DB_PASSWORD = 'secret'
    process.env.TENANT_DB_PORT = '5432'
    process.env.TENANT_DB_HOST_SUFFIX = ''
    process.env.SERVICE_DB_NAME = 'travelmanager_trip'
    expect(tenantConnString('tui')).toBe('postgresql://tmuser:secret@postgres-tui:5432/travelmanager_trip')
  })

  it('derives the db name from DATABASE_URL when SERVICE_DB_NAME is unset', () => {
    delete process.env.SERVICE_DB_NAME
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@pgbouncer:6432/travelmanager_social'
    process.env.TENANT_DB_USER = 'postgres'
    process.env.TENANT_DB_PASSWORD = 'postgres'
    expect(tenantConnString('acme')).toBe('postgresql://postgres:postgres@postgres-acme:5432/travelmanager_social')
  })

  it('applies a cross-namespace host suffix', () => {
    process.env.SERVICE_DB_NAME = 'travelmanager_trip'
    process.env.TENANT_DB_HOST_SUFFIX = '.tm.svc.cluster.local'
    expect(tenantConnString('tui')).toContain('@postgres-tui.tm.svc.cluster.local:5432/')
  })
})
