// Trip DB schema. Owns trips, plan_locations, reviews and travel_plans.
//
// DB-per-service: there is no users table here, so the old hard FKs to
// users(firebase_uid) are gone. Author/reviewer display names are denormalised
// (captured from the gateway identity at write time) so the hot read paths
// (trips/all, reviews list) never need a cross-service join. travel_plans keeps
// destination/route/option IDs but does NOT FK them — template plans are
// hydrated by calling the Destination service over HTTP.
import { getDb } from '@travelmanager/shared/db'

export async function initTripDb() {
  const db = getDb()

  await db.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id                  SERIAL      PRIMARY KEY,
      user_uid            TEXT        NOT NULL,
      author_name         TEXT        NOT NULL DEFAULT '',
      title               TEXT        NOT NULL,
      destination         TEXT        NOT NULL,
      origin              TEXT        NOT NULL DEFAULT '',
      start_date          TEXT        NOT NULL,
      short_description   TEXT        NOT NULL,
      detail_description  TEXT        NOT NULL DEFAULT '',
      dest_lat            NUMERIC,
      dest_lng            NUMERIC,
      dest_country        TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );

    -- Backfill columns on pre-existing tables (CREATE IF NOT EXISTS above is a
    -- no-op once the table exists, so new columns need an explicit ADD).
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS dest_lat NUMERIC;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS dest_lng NUMERIC;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS dest_country TEXT;
    -- Denormalised like tally (source of truth = Firestore) so recommendations
    -- can rank by popularity in plain SQL without N Firestore reads.
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;

    -- Composite covers the "my trips" page (WHERE user_uid ORDER BY start_date
    -- DESC) as a single index scan; the leading column also serves any plain
    -- user_uid lookup, so the old trips_user_uid_idx is redundant — drop it to
    -- save write overhead.
    DROP INDEX IF EXISTS trips_user_uid_idx;
    CREATE INDEX IF NOT EXISTS trips_user_start_idx ON trips (user_uid, start_date DESC);
    -- Global recency sort (trips/all) and the active-trips range scan
    -- (start_date >= CURRENT_DATE ORDER BY start_date).
    CREATE INDEX IF NOT EXISTS trips_start_date_idx ON trips (start_date);

    CREATE TABLE IF NOT EXISTS plan_locations (
      id          SERIAL      PRIMARY KEY,
      trip_id     INTEGER     NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name        TEXT        NOT NULL,
      description TEXT        NOT NULL DEFAULT '',
      image_url   TEXT        NOT NULL DEFAULT '',
      latitude    NUMERIC,
      longitude   NUMERIC,
      date_from   DATE,
      date_to     DATE,
      position    INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE plan_locations ADD COLUMN IF NOT EXISTS latitude  NUMERIC;
    ALTER TABLE plan_locations ADD COLUMN IF NOT EXISTS longitude NUMERIC;
    -- Place category (hotel | restaurant | airport | attraction | other) so the
    -- autocomplete can filter to that place type and the map can icon it.
    ALTER TABLE plan_locations ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';

    -- Locations are always fetched per trip, ordered by position. No
    -- UNIQUE/FK index exists on trip_id, so this avoids a seq scan per fetch.
    CREATE INDEX IF NOT EXISTS plan_locations_trip_pos_idx ON plan_locations (trip_id, position);

    CREATE TABLE IF NOT EXISTS reviews (
      id            SERIAL      PRIMARY KEY,
      trip_id       INTEGER     NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      reviewer_id   TEXT        NOT NULL,
      reviewer_name TEXT        NOT NULL DEFAULT '',
      stars         INTEGER     NOT NULL CHECK (stars BETWEEN 1 AND 5),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(trip_id, reviewer_id)
    );

    CREATE TABLE IF NOT EXISTS travel_plans (
      id                      SERIAL  PRIMARY KEY,
      trip_id                 INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE UNIQUE,
      mode                    TEXT    NOT NULL DEFAULT 'template',
      destination_id          INTEGER,
      route_id                INTEGER,
      transport_option_id     INTEGER,
      accommodation_option_id INTEGER,
      notes                   TEXT    NOT NULL DEFAULT '',
      custom_destination                   TEXT,
      custom_route_name                    TEXT,
      custom_route_description             TEXT,
      custom_duration_days                 INTEGER,
      custom_highlights                    TEXT,
      custom_transport_type                TEXT,
      custom_transport_provider            TEXT,
      custom_transport_duration            TEXT,
      custom_transport_price_from          INTEGER,
      custom_transport_notes               TEXT,
      custom_accommodation_type            TEXT,
      custom_accommodation_name            TEXT,
      custom_accommodation_price_per_night INTEGER,
      custom_accommodation_rating          NUMERIC(2,1),
      custom_accommodation_notes           TEXT,
      created_at              TIMESTAMPTZ DEFAULT NOW(),
      updated_at              TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // pgvector: per-trip embeddings for semantic recommendations. Isolated in its
  // own try (after the trips table exists) so a role lacking CREATE EXTENSION
  // (Cloud SQL: enable once as cloudsqlsuperuser) never blocks service boot —
  // embeddings simply stay unavailable until the extension is present.
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS vector')
    await db.query(`
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS embedding vector(768);
      CREATE INDEX IF NOT EXISTS trips_embedding_idx
        ON trips USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `)
  } catch (e) {
    console.error('[trip-service] pgvector setup skipped (embeddings disabled):', e?.message || e)
  }
}
