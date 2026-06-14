// POST /api/tasks/backfill-embeddings — fills trips.embedding for rows missing
// it: pre-existing trips, create/update-time embed failures, and the first run
// after Vertex creds land. Idempotent, batched, safe to re-run on a schedule.
// Internal task endpoint (CronJob); not routed through the public gateway.
//
// Runs once per tenant (shared free DB + each provisioned tenant pod) so standard
// tenants' trips get embeddings too.
import { forEachTenant } from '@travelmanager/shared/tenant-db'
import { embedBatch, toVectorLiteral } from '@travelmanager/shared/embed'
import { tripText } from '../../utils/embedding.js'

async function backfillOne(db) {
  let rows
  try {
    ;({ rows } = await db.query(
      `SELECT id, title, destination, dest_country, short_description, detail_description
       FROM trips WHERE embedding IS NULL LIMIT 200`
    ))
  } catch (e) {
    // embedding column absent (pgvector not enabled) — nothing to do.
    console.error('[trip-service] backfill-embeddings skipped:', e?.message || e)
    return { ok: false, reason: 'pgvector unavailable', scanned: 0, updated: 0 }
  }

  if (!rows.length) return { ok: true, scanned: 0, updated: 0 }

  const vectors = await embedBatch(rows.map(tripText))
  let updated = 0
  for (let i = 0; i < rows.length; i++) {
    const literal = toVectorLiteral(vectors[i])
    if (!literal) continue // Vertex unavailable for this batch — try again next run.
    await db.query('UPDATE trips SET embedding = $1::vector WHERE id = $2', [literal, rows[i].id])
    updated++
  }

  return { ok: true, scanned: rows.length, updated }
}

export default defineEventHandler(async () => {
  const perTenant = await forEachTenant((db) => backfillOne(db))
  const scanned = perTenant.reduce((n, t) => n + (t.result?.scanned || 0), 0)
  const updated = perTenant.reduce((n, t) => n + (t.result?.updated || 0), 0)
  return { ok: true, tenants: perTenant.length, scanned, updated }
})
