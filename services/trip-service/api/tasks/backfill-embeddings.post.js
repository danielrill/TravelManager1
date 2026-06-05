// POST /api/tasks/backfill-embeddings — fills trips.embedding for rows missing
// it: pre-existing trips, create/update-time embed failures, and the first run
// after Vertex creds land. Idempotent, batched, safe to re-run on a schedule.
// Internal task endpoint (CronJob); not routed through the public gateway.
import { getDb } from '@travelmanager/shared/db'
import { embedBatch, toVectorLiteral } from '@travelmanager/shared/embed'
import { tripText } from '../../utils/embedding.js'

export default defineEventHandler(async () => {
  const db = getDb()

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
})
