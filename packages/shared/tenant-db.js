// Per-tenant connection routing.
//
// Multitenancy model: the FREE tier ('default') lives on the shared database
// (the existing getDb() pool / Cloud SQL). Each STANDARD tenant gets its own
// dedicated Postgres pod (StatefulSet `postgres-<id>`), provisioned on demand.
// Services pick the right pool per request from event.context.user.tenantId,
// which the gateway derives from the request's subdomain.
//
// Pools are cached per tenant id (one pg.Pool per tenant pod, lazily created)
// so we don't open a fresh connection per request. The tenant pod hosts the
// SAME per-service database layout as the shared DB, so a service only swaps
// host + credentials — its SQL and table names are unchanged.
import pg from 'pg'
import { getDb } from './db.js'

const { Pool } = pg

// Tenant ids are subdomain slugs. Validate before interpolating into a hostname
// or connection string so a forged x-tenant-id header can never inject.
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/

const pools = new Map() // tenantId -> pg.Pool

// Build the connection string for a tenant's dedicated Postgres pod. Host follows
// the StatefulSet Service name convention (`postgres-<id>`), so adding a tenant
// needs no service redeploy. Credentials + the service-specific database name come
// from the environment (a shared cluster-internal credential in v1; pods are
// NetworkPolicy-isolated). SERVICE_DB_NAME is the per-service db (travelmanager_<svc>).
// The per-service database name (e.g. travelmanager_trip). Explicit SERVICE_DB_NAME
// wins; otherwise it's parsed from the service's own DATABASE_URL path, so no new
// per-service env var is needed — the tenant pod mirrors the shared DB layout.
function serviceDbName() {
  if (process.env.SERVICE_DB_NAME) return process.env.SERVICE_DB_NAME
  const url = process.env.DATABASE_URL
  if (url) {
    try {
      const name = new URL(url).pathname.replace(/^\//, '')
      if (name) return name
    } catch { /* malformed URL — fall through */ }
  }
  return null
}

// Discrete pg config (not a connection-string URL): pg 8.x parses a
// `connectionString` via `new URL()`, which throws a bare "Invalid URL" when the
// env-injected credentials contain URL-special chars or the port is non-numeric.
// Passing host/port/user/password/database directly skips URL parsing entirely.
export function tenantConn(tid) {
  const dbName = serviceDbName()
  if (!dbName) {
    throw new Error('cannot resolve tenant DB name (set SERVICE_DB_NAME or DATABASE_URL)')
  }
  const suffix = process.env.TENANT_DB_HOST_SUFFIX || '' // e.g. '.travelmanager.svc.cluster.local'
  return {
    host: `postgres-${tid}${suffix}`,
    port: Number(process.env.TENANT_DB_PORT || 5432),
    user: process.env.TENANT_DB_USER || process.env.PGUSER || 'postgres',
    password: process.env.TENANT_DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
    database: dbName,
  }
}

// Return the pg.Pool for a tenant id. 'default' (free tier) → shared pool.
export function poolForTenant(tid) {
  if (!tid || tid === 'default') return getDb()
  // Validate before any host/connstring use so a forged tenant id can never inject,
  // regardless of routing mode below.
  if (!ID_RE.test(tid)) throw new Error(`bad tenant id: ${tid}`)
  // No per-tenant Postgres pods on this cluster: free tier shares the DB, and an
  // enterprise fixed-tenant cluster runs on its own dedicated Cloud SQL reached via
  // the service's DATABASE_URL. Either way there is no `postgres-<id>` pod to route
  // to, so every tenant uses the shared getDb() pool. Mirrors the gateway's gate in
  // api-gateway/utils/routing.js (TENANT_DEDICATED_PODS !== '1' → shared).
  if (process.env.TENANT_DEDICATED_PODS !== '1') return getDb()
  let pool = pools.get(tid)
  if (!pool) {
    pool = new Pool(tenantConn(tid))
    pools.set(tid, pool)
  }
  return pool
}

// Request-scoped helper: pick the pool for the caller's tenant. Drop-in for
// getDb() — the returned object exposes the same .query()/.connect() surface.
export function tenantDb(event) {
  const tid = event?.context?.user?.tenantId || event?.context?.tenantId || 'default'
  return poolForTenant(tid)
}

// List every tenant id that background jobs must process: the shared 'default'
// tenant plus all provisioned standard tenants. Crons iterate this and run their
// work once per tenant against poolForTenant(id) — without it, standard tenants
// silently get no newsletters / alerts / embedding backfills. Cached briefly so
// a cron's inner loop doesn't hammer the user-service.
let _tenantIdsCache = null
let _tenantIdsAt = 0
const TENANT_IDS_TTL_MS = 60_000

export async function listTenantIds() {
  const now = Date.now()
  if (_tenantIdsCache && now - _tenantIdsAt < TENANT_IDS_TTL_MS) return _tenantIdsCache
  const userUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
  const ids = ['default']
  try {
    const rows = await globalThis.$fetch('/api/internal/tenants', { baseURL: userUrl })
    for (const t of rows || []) {
      if (t?.id && t.id !== 'default' && t.provisioned_at) ids.push(t.id)
    }
  } catch (e) {
    console.error('[tenant-db] listTenantIds failed; processing default only:', e?.message || e)
  }
  _tenantIdsCache = ids
  _tenantIdsAt = now
  return ids
}

// Run fn(pool, tenantId) for every tenant (shared default + provisioned pods).
// Errors in one tenant are logged and skipped so one bad pod doesn't abort the
// whole cron run.
export async function forEachTenant(fn) {
  const ids = await listTenantIds()
  const results = []
  for (const id of ids) {
    try {
      results.push({ tenantId: id, result: await fn(poolForTenant(id), id) })
    } catch (e) {
      console.error(`[tenant-db] forEachTenant ${id} failed:`, e?.message || e)
      results.push({ tenantId: id, error: String(e?.message || e) })
    }
  }
  return results
}

// For maintenance / shutdown: close every cached tenant pool (not the shared one).
export async function closeTenantPools() {
  await Promise.all([...pools.values()].map((p) => p.end().catch(() => {})))
  pools.clear()
}
