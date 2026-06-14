// Tenant provisioning orchestration: create the Postgres pod, wait for it, create
// the per-service databases on it, then ask each isolated service to bootstrap
// its schema in that database. Idempotent end-to-end.
import pg from 'pg'
import { createTenantPostgres, waitForTenantPostgres, createTenantApps, waitForTenantApps, k8sEnabled } from './k8s.js'

const { Client } = pg
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/

// Services whose data is isolated per tenant (each gets a database on the pod).
// key → { url, db }. Reference/control-plane services (user, destination,
// travel-info, notification) stay on the shared DB and are NOT provisioned here.
function targets() {
  return [
    { key: 'trip', url: process.env.TRIP_SERVICE_URL || 'http://localhost:3002', db: 'travelmanager_trip' },
    { key: 'social', url: process.env.SOCIAL_SERVICE_URL || 'http://localhost:3004', db: 'travelmanager_social' },
  ]
}

// Admin (maintenance) connection to a tenant pod's default `postgres` database,
// used only to CREATE DATABASE. Host follows the StatefulSet Service convention.
function adminConnString(id) {
  const user = process.env.TENANT_DB_USER || 'postgres'
  const pw = process.env.TENANT_DB_PASSWORD || 'postgres'
  const port = process.env.TENANT_DB_PORT || '5432'
  const suffix = process.env.TENANT_DB_HOST_SUFFIX || ''
  const host = process.env.PROVISIONER_DB_HOST_OVERRIDE || `postgres-${id}${suffix}`
  return `postgresql://${user}:${pw}@${host}:${port}/postgres`
}

// CREATE DATABASE for each isolated service (no IF NOT EXISTS in Postgres, so
// guard on pg_database).
async function ensureDatabases(id, dbNames) {
  const client = new Client({ connectionString: adminConnString(id) })
  await client.connect()
  try {
    for (const name of dbNames) {
      const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
      if (!rows.length) {
        // Identifier is from our fixed targets() list, not user input — safe.
        await client.query(`CREATE DATABASE "${name}"`)
      }
    }
  } finally {
    await client.end()
  }
}

// Full provisioning for a tenant id. Returns a step report.
export async function provisionTenant(id) {
  if (!ID_RE.test(id)) throw new Error(`bad tenant id: ${id}`)
  const steps = { k8s: null, databases: null, schemas: [], apps: null }
  const tg = targets()

  // 1. Pod + Service + NetworkPolicy.
  steps.k8s = await createTenantPostgres(id)
  await waitForTenantPostgres(id)

  // 2. Per-service databases on the pod.
  await ensureDatabases(id, tg.map((t) => t.db))
  steps.databases = tg.map((t) => t.db)

  // 3. Each isolated service bootstraps its schema in its tenant database.
  for (const t of tg) {
    try {
      const res = await $fetch('/api/internal/provision', {
        method: 'POST',
        baseURL: t.url,
        body: { tenantId: id },
      })
      steps.schemas.push({ service: t.key, ok: true, res })
    } catch (e) {
      steps.schemas.push({ service: t.key, ok: false, error: String(e?.message || e) })
      throw new Error(`schema provision failed for ${t.key}: ${e?.message || e}`)
    }
  }

  // 4. Dedicated application pods for this tenant (Deployment + Service + HPA per
  //    backend service), then wait until they're serving so the gateway can route
  //    to them. Schema bootstrap above used the SHARED services, so the DB is ready.
  steps.apps = await createTenantApps(id)
  await waitForTenantApps(id)

  return { id, k8sEnabled: k8sEnabled(), ...steps }
}
