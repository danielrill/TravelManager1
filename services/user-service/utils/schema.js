// User DB schema. Owns user profiles plus the SaaS tenant/plan tables that the
// API Gateway reads to enforce tiers (Free / Standard / Enterprise) and
// white-labelling. Auto-imported by Nitro (initUserDb is callable globally).
import { getDb } from '@travelmanager/shared/db'

export async function initUserDb(db = getDb()) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id            TEXT        PRIMARY KEY,
      name          TEXT        NOT NULL,
      plan          TEXT        NOT NULL DEFAULT 'free',
      logo_url      TEXT        NOT NULL DEFAULT '',
      brand_color   TEXT        NOT NULL DEFAULT '',
      custom_domain TEXT        NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Multitenancy: subdomain drives Host-based tenant resolution at the gateway,
    -- rate_limit_per_min overrides the plan default, provisioned_at marks when the
    -- tenant's dedicated Postgres pod finished bootstrapping (NULL = not yet live).
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain         TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioned_at    TIMESTAMPTZ;
    -- Access code a first-time visitor must enter on the tenant's subdomain to
    -- join it (the operator hands this to the customer). NULL for the free apex.
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_code       TEXT;

    -- Enterprise tier: this tenant runs on its OWN dedicated GKE cluster (not a
    -- pod on the shared cluster). These columns capture the cluster's identity and
    -- networking so the admin console can surface the ingress IP (customer points
    -- their own DNS at it) and track custom-domain TLS readiness. NULL for free /
    -- standard tenants (which have no dedicated cluster).
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cluster_name             TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ingress_ip               TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS system_hostname          TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tls_status               TEXT;

    -- One subdomain per tenant (NULLs allowed: the default/free tenant is the apex).
    CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_idx ON tenants (subdomain) WHERE subdomain IS NOT NULL;

    -- Default catch-all tenant = the FREE product at the apex (no subdomain). It
    -- lives on the shared DB and is always considered provisioned.
    INSERT INTO tenants (id, name, plan, provisioned_at)
    VALUES ('default', 'TravelManager', 'free', NOW())
    ON CONFLICT (id) DO NOTHING;

    -- The apex is always the free product. Heal any legacy row that was seeded
    -- as a paid plan (the INSERT above no-ops once the row exists).
    UPDATE tenants SET plan = 'free' WHERE id = 'default' AND plan <> 'free';

    CREATE TABLE IF NOT EXISTS users (
      firebase_uid TEXT        PRIMARY KEY,
      email        TEXT        NOT NULL UNIQUE,
      name         TEXT        NOT NULL,
      bio          TEXT        NOT NULL DEFAULT '',
      home_city    TEXT        NOT NULL DEFAULT '',
      avatar_url   TEXT        NOT NULL DEFAULT '',
      tenant_id    TEXT        NOT NULL DEFAULT 'default',
      role         TEXT        NOT NULL DEFAULT 'traveler',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    -- Enterprise provisioning jobs. An enterprise tenant is built by a Terraform
    -- Kubernetes Job (creates a dedicated GKE cluster + Cloud SQL — 10-15 min) and
    -- torn down the same way. This control-plane table is the durable audit trail
    -- of those long-running Jobs; status is reconciled from the provisioner's live
    -- view of the k8s Job each time the admin console polls. kind=create|destroy.
    CREATE TABLE IF NOT EXISTS provisioning_jobs (
      id              BIGSERIAL   PRIMARY KEY,
      tenant_id       TEXT        NOT NULL,
      kind            TEXT        NOT NULL,
      status          TEXT        NOT NULL DEFAULT 'pending',
      job_name        TEXT,
      cluster_name    TEXT,
      ingress_ip      TEXT,
      system_hostname TEXT,
      error           TEXT,
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      finished_at     TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- One in-flight job row per tenant+kind (re-running an apply updates it in place).
    CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_tenant_kind_idx
      ON provisioning_jobs (tenant_id, kind);
  `)

  // On a dedicated ENTERPRISE cluster, seed this cluster's single tenant row so
  // white-label config (/api/tenants/current) and plan resolution return the
  // enterprise tier rather than falling back to the free apex. FIXED_TENANT_ID is
  // set only in the enterprise cluster's deployment values.
  const fixedTenant = process.env.FIXED_TENANT_ID
  if (fixedTenant) {
    await db.query(
      `INSERT INTO tenants (id, name, plan, provisioned_at)
       VALUES ($1, $2, 'enterprise', NOW())
       ON CONFLICT (id) DO UPDATE SET plan = 'enterprise'`,
      [fixedTenant, process.env.FIXED_TENANT_NAME || fixedTenant]
    )
  }
}
