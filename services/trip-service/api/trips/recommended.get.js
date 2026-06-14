// GET /api/trips/recommended — "For You": public trips ranked by semantic
// relevance to the caller, beyond who they follow. Query-time (no Pub/Sub), so
// it works the same locally and in prod.
//
// Engine (shared with the newsletter): a taste vector built from the trips the
// user created + liked drives a pgvector cosine-similarity search. New users, or
// a DB without embeddings/pgvector, fall through to a popularity ranking. See
// utils/recommend.js.
import { tenantDb } from '@travelmanager/shared/tenant-db'
import { recommendForUser } from '../../utils/recommend.js'

export default defineEventHandler(async (event) => {
  const me = event.context.user?.uid || null
  return recommendForUser(tenantDb(event), me, { limit: 30 })
})
