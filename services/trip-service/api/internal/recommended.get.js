// GET /api/internal/recommended?uid=<uid>&limit=10 — personalized trip
// recommendations for a user, used by the Social service's newsletter job.
// Internal; not routed through the public gateway.
import { getDb } from '@travelmanager/shared/db'
import { recommendForUser } from '../../utils/recommend.js'

export default defineEventHandler(async (event) => {
  const { uid, limit } = getQuery(event)
  if (!uid) return []
  const n = Math.min(Math.max(Number(limit) || 10, 1), 50)
  return recommendForUser(getDb(), String(uid), { limit: n })
})
