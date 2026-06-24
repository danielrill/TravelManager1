// GET /api/trips/recommended — "For You": public trips ranked by semantic
// relevance to the caller, beyond who they follow. Query-time (no Pub/Sub), so
// it works the same locally and in prod.
//
// Engine (shared with the newsletter): a taste vector built from the trips the
// user created + liked drives a pgvector cosine-similarity search. New users, or
// a DB without embeddings/pgvector, fall through to a popularity ranking. See
// utils/recommend.js.
import { tenantDb } from '@travelmanager/shared/tenant-db'
import { recordUsage } from '@travelmanager/shared/metering'
import { recommendForUser } from '../../utils/recommend.js'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  const me = user?.uid || null
  const recs = await recommendForUser(tenantDb(event), me, { limit: 30 })

  // Meter a billable ai_recommendation only when a genuine personalized ("foryou")
  // result was served — the popularity/new fallback (no embeddings / no taste) is
  // not an AI unit. One unit per served personalized request. Best-effort; free
  // tier is skipped inside recordUsage.
  if (me && recs.some((r) => r.reason === 'foryou')) {
    recordUsage(user.tenantId, 'ai_recommendation', 1, {
      idempotencyKey: `rec:${me}:${Date.now()}`,
      source: 'trip-service',
      plan: user.plan,
    }).catch((e) => console.error('[trip-service] meter ai_recommendation failed', e))
  }

  return recs
})
