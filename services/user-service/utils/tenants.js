// Tenant control-plane helpers shared by the internal ops endpoints and the
// admin onboarding API. Auto-imported by Nitro.
import { randomBytes } from 'node:crypto'
import { getDb } from '@travelmanager/shared/db'

export const PLANS = ['free', 'standard', 'enterprise']

// Tenant access code the operator shares with the customer. Unambiguous alphabet
// (no 0/O/1/I), 10 chars — enough entropy to not be guessable, easy to read out.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function genSignupCode(len = 10) {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

// Upsert a tenant. Omitted fields are preserved on update (COALESCE); plan
// defaults to 'free' only on first insert. Does NOT touch provisioned_at — that
// is set explicitly once the tenant's pod is live (see markProvisioned).
export async function upsertTenant(id, b = {}, db = getDb()) {
  const { rows } = await db.query(
    `INSERT INTO tenants (id, name, plan, logo_url, brand_color, custom_domain, subdomain, rate_limit_per_min, signup_code)
     VALUES ($1, COALESCE(NULLIF($2,''), $1), COALESCE($3,'free'), COALESCE($4,''), COALESCE($5,''), COALESCE($6,''), $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name               = COALESCE(NULLIF($2,''), tenants.name),
       plan               = COALESCE($3, tenants.plan),
       logo_url           = COALESCE($4, tenants.logo_url),
       brand_color        = COALESCE($5, tenants.brand_color),
       custom_domain      = COALESCE($6, tenants.custom_domain),
       subdomain          = COALESCE($7, tenants.subdomain),
       rate_limit_per_min = COALESCE($8, tenants.rate_limit_per_min),
       signup_code        = COALESCE($9, tenants.signup_code)
     RETURNING id, name, plan, logo_url, brand_color, custom_domain, subdomain, rate_limit_per_min, signup_code, provisioned_at`,
    [
      id,
      b.name ?? '',
      b.plan ?? null,
      b.logo_url ?? null,
      b.brand_color ?? null,
      b.custom_domain ?? null,
      b.subdomain ?? null,
      b.rate_limit_per_min ?? null,
      b.signup_code ?? null,
    ]
  )
  return rows[0]
}

export async function markProvisioned(id, db = getDb()) {
  await db.query('UPDATE tenants SET provisioned_at = NOW() WHERE id = $1', [id])
}

export async function listTenants(db = getDb()) {
  const { rows } = await db.query(
    `SELECT id, name, plan, subdomain, rate_limit_per_min, signup_code, provisioned_at, created_at,
            custom_domain, cluster_name, ingress_ip, system_hostname, tls_status
     FROM tenants ORDER BY created_at ASC`
  )
  return rows
}

// ─── Enterprise provisioning jobs (dedicated-cluster lifecycle) ──────────────

// Record (or refresh) the in-flight provisioning Job for a tenant. One row per
// (tenant, kind); a re-run updates it in place. Outputs (cluster_name, ingress_ip,
// system_hostname) and error are written as the provisioner reports them.
export async function upsertProvisioningJob(tenantId, kind, fields = {}, db = getDb()) {
  const done = fields.status === 'live' || fields.status === 'failed'
  const { rows } = await db.query(
    `INSERT INTO provisioning_jobs
       (tenant_id, kind, status, job_name, cluster_name, ingress_ip, system_hostname, error,
        finished_at, updated_at)
     VALUES ($1, $2, COALESCE($3,'pending'), $4, $5, $6, $7, $8,
        CASE WHEN $9 THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (tenant_id, kind) DO UPDATE SET
       status          = COALESCE($3, provisioning_jobs.status),
       job_name        = COALESCE($4, provisioning_jobs.job_name),
       cluster_name    = COALESCE($5, provisioning_jobs.cluster_name),
       ingress_ip      = COALESCE($6, provisioning_jobs.ingress_ip),
       system_hostname = COALESCE($7, provisioning_jobs.system_hostname),
       error           = $8,
       finished_at     = CASE WHEN $9 THEN NOW() ELSE provisioning_jobs.finished_at END,
       updated_at      = NOW()
     RETURNING *`,
    [
      tenantId,
      kind,
      fields.status ?? null,
      fields.job_name ?? null,
      fields.cluster_name ?? null,
      fields.ingress_ip ?? null,
      fields.system_hostname ?? null,
      fields.error ?? null,
      done,
    ]
  )
  return rows[0]
}

export async function getProvisioningJob(tenantId, kind, db = getDb()) {
  const { rows } = await db.query(
    'SELECT * FROM provisioning_jobs WHERE tenant_id = $1 AND kind = $2',
    [tenantId, kind]
  )
  return rows[0] || null
}

// Persist the dedicated cluster's identity + networking on the tenant row once the
// enterprise apply Job reports its Terraform outputs.
export async function setTenantClusterInfo(id, { cluster_name, ingress_ip, system_hostname } = {}, db = getDb()) {
  await db.query(
    `UPDATE tenants SET
       cluster_name    = COALESCE($2, cluster_name),
       ingress_ip      = COALESCE($3, ingress_ip),
       system_hostname = COALESCE($4, system_hostname)
     WHERE id = $1`,
    [id, cluster_name ?? null, ingress_ip ?? null, system_hostname ?? null]
  )
}

// Validate a signup code against a tenant's stored code. Returns true on match.
export async function checkSignupCode(tenantId, code, db = getDb()) {
  if (!tenantId || tenantId === 'default' || !code) return false
  const { rows } = await db.query('SELECT signup_code FROM tenants WHERE id = $1', [tenantId])
  const stored = rows[0]?.signup_code
  return Boolean(stored) && stored === String(code)
}
