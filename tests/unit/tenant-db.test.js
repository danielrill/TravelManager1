import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { poolForTenant, tenantConn, tenantDb } from '../../packages/shared/tenant-db.js'
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

describe('tenantConn', () => {
  it('builds discrete per-tenant pod pg config from the convention + env', () => {
    process.env.TENANT_DB_USER = 'tmuser'
    process.env.TENANT_DB_PASSWORD = 'secret'
    process.env.TENANT_DB_PORT = '5432'
    process.env.TENANT_DB_HOST_SUFFIX = ''
    process.env.SERVICE_DB_NAME = 'travelmanager_trip'
    expect(tenantConn('tui')).toEqual({
      host: 'postgres-tui',
      port: 5432,
      user: 'tmuser',
      password: 'secret',
      database: 'travelmanager_trip',
    })
  })

  it('derives the db name from DATABASE_URL when SERVICE_DB_NAME is unset', () => {
    delete process.env.SERVICE_DB_NAME
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@pgbouncer:6432/travelmanager_social'
    process.env.TENANT_DB_USER = 'postgres'
    process.env.TENANT_DB_PASSWORD = 'postgres'
    expect(tenantConn('acme')).toMatchObject({ host: 'postgres-acme', database: 'travelmanager_social' })
  })

  it('applies a cross-namespace host suffix', () => {
    process.env.SERVICE_DB_NAME = 'travelmanager_trip'
    process.env.TENANT_DB_HOST_SUFFIX = '.tm.svc.cluster.local'
    expect(tenantConn('tui').host).toBe('postgres-tui.tm.svc.cluster.local')
  })

  it('passes URL-special-char credentials through untouched (no Invalid URL)', () => {
    process.env.SERVICE_DB_NAME = 'travelmanager_trip'
    process.env.TENANT_DB_HOST_SUFFIX = ''
    process.env.TENANT_DB_USER = 'postgres'
    process.env.TENANT_DB_PASSWORD = 'p@ss/w#rd:%x'
    expect(tenantConn('tui').password).toBe('p@ss/w#rd:%x')
  })
})
