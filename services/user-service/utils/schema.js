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
  `)
}
