// Metering schema (shared DB). All tables keyed by tenant_id so one operator
// instance bills across every tenant without fanning out to per-tenant pods.
//
//   usage_events      — immutable ledger; UNIQUE(tenant_id, idempotency_key) is the
//                       dedupe key that makes at-least-once Pub/Sub effectively-once.
//   usage_counters    — pre-aggregated read model (per tenant/dimension/period).
//   rate_cards        — per-plan price book, versioned by effective_from.
//   tenant_rate_overrides — per-tenant negotiated rates (enterprise); NULL inherits.
//   invoices          — finalised per-period bills (stable historical record).
import { getDb } from '@travelmanager/shared/db'
import { DIMENSIONS } from '@travelmanager/shared/rating'

export async function initMeteringDb() {
  const db = getDb()
  await db.query(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id              BIGSERIAL    PRIMARY KEY,
      tenant_id       TEXT         NOT NULL,
      dimension       TEXT         NOT NULL,
      quantity        BIGINT       NOT NULL DEFAULT 1,
      billing_period  TEXT         NOT NULL,
      idempotency_key TEXT         NOT NULL,
      source          TEXT         NOT NULL DEFAULT '',
      occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS usage_events_rollup_idx
      ON usage_events (tenant_id, billing_period, dimension);

    CREATE TABLE IF NOT EXISTS usage_counters (
      tenant_id       TEXT         NOT NULL,
      dimension       TEXT         NOT NULL,
      billing_period  TEXT         NOT NULL,
      total_quantity  BIGINT       NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, dimension, billing_period)
    );

    CREATE TABLE IF NOT EXISTS rate_cards (
      plan            TEXT          NOT NULL,
      dimension       TEXT          NOT NULL,
      included_qty    BIGINT        NOT NULL DEFAULT 0,
      unit_rate_cents NUMERIC(12,4) NOT NULL DEFAULT 0,
      base_fee_cents  INTEGER       NOT NULL DEFAULT 0,
      effective_from  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (plan, dimension, effective_from)
    );

    CREATE TABLE IF NOT EXISTS tenant_rate_overrides (
      tenant_id       TEXT          NOT NULL,
      dimension       TEXT          NOT NULL,
      included_qty    BIGINT,
      unit_rate_cents NUMERIC(12,4),
      effective_from  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, dimension, effective_from)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      tenant_id       TEXT          NOT NULL,
      billing_period  TEXT          NOT NULL,
      plan            TEXT          NOT NULL,
      total_cents     BIGINT        NOT NULL DEFAULT 0,
      lines           JSONB         NOT NULL DEFAULT '[]'::jsonb,
      finalized_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, billing_period)
    );
  `)

  await seedDefaultRateCards(db)
  await migrateStandardToUsageOnly(db)
}

// One-time pricing migration: Standard moved to a €29.99 one-time setup fee + 100%
// usage-based billing, so it must carry NO recurring base_fee. Older deployments
// seeded api_request.base_fee_cents=4900; rate_cards is append-only/versioned, so we
// append a zero-fee version of any Standard dimension whose currently-effective card
// still has a base fee. loadPlanCard picks the latest effective_from per dimension, so
// the new row takes over while history stays intact. Idempotent: no-op once clean.
async function migrateStandardToUsageOnly(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (dimension) dimension, included_qty, unit_rate_cents, base_fee_cents
       FROM rate_cards WHERE plan = 'standard' AND effective_from <= NOW()
      ORDER BY dimension, effective_from DESC`,
  )
  for (const r of rows) {
    if (Number(r.base_fee_cents) === 0) continue
    await db.query(
      `INSERT INTO rate_cards (plan, dimension, included_qty, unit_rate_cents, base_fee_cents)
       VALUES ('standard', $1, $2, $3, 0)`,
      [r.dimension, r.included_qty, r.unit_rate_cents],
    )
  }
}

// Seed illustrative default rate cards for the billable tiers (operator can
// override per-plan or per-tenant via the admin API). Idempotent: only inserts a
// plan/dimension that has no card yet, so it never stomps operator edits.
const DEFAULT_CARDS = {
  // Standard is 100% usage-based: NO recurring base fee on any dimension (the €29.99
  // is a one-time onboarding charge, see PLANS.standard.oneTimeSetupCents). Tenants
  // pay only for what they use beyond the included allowances.
  standard: {
    api_request:       { included_qty: 1_000_000, unit_rate_cents: 0.01,  base_fee_cents: 0 },
    ai_recommendation: { included_qty: 5_000,     unit_rate_cents: 2,     base_fee_cents: 0 },
    active_seat:       { included_qty: 5,         unit_rate_cents: 500,   base_fee_cents: 0 },
    trip_created:      { included_qty: 10_000,    unit_rate_cents: 1,     base_fee_cents: 0 },
  },
  enterprise: {
    api_request:       { included_qty: 10_000_000, unit_rate_cents: 0.005, base_fee_cents: 49900 },
    ai_recommendation: { included_qty: 100_000,    unit_rate_cents: 1,     base_fee_cents: 0 },
    active_seat:       { included_qty: 50,         unit_rate_cents: 400,   base_fee_cents: 0 },
    trip_created:      { included_qty: 1_000_000,  unit_rate_cents: 0.5,   base_fee_cents: 0 },
  },
}

async function seedDefaultRateCards(db) {
  for (const [plan, dims] of Object.entries(DEFAULT_CARDS)) {
    for (const dim of DIMENSIONS) {
      const c = dims[dim]
      if (!c) continue
      // Only seed when this plan has no card for the dimension at all.
      const { rows } = await db.query(
        'SELECT 1 FROM rate_cards WHERE plan = $1 AND dimension = $2 LIMIT 1',
        [plan, dim],
      )
      if (rows.length) continue
      await db.query(
        `INSERT INTO rate_cards (plan, dimension, included_qty, unit_rate_cents, base_fee_cents)
         VALUES ($1,$2,$3,$4,$5)`,
        [plan, dim, c.included_qty, c.unit_rate_cents, c.base_fee_cents],
      )
    }
  }
}
