// Shared recommendation engine — powers both the user-facing "For You" page
// (/api/trips/recommended) and the weekly newsletter (via /api/internal/recommended).
//
// Semantic: a user's "taste vector" is the centroid (pgvector avg) of the
// embeddings of the trips they created + liked; candidates are the public trips
// closest to it by cosine distance (embedding <=> taste).
//
// Degrades gracefully: a user with no taste signal, no embeddings yet, or a DB
// without pgvector falls through to a popularity + recency ranking. Nothing here
// throws into the request path.
import { getFirestoreDb } from '@travelmanager/shared/firebase'

const COLS = `id, title, destination, dest_country, start_date, short_description,
              user_uid, author_name, COALESCE(like_count, 0) AS like_count`

// Trip ids this user liked, via the Firestore likes reverse-lookup
// (likes/{tripId}/users/{uid} carries a `uid` field; collectionGroup finds them).
async function likedTripIds(uid) {
  try {
    const snap = await getFirestoreDb().collectionGroup('users').where('uid', '==', uid).get()
    return snap.docs.map(d => Number(d.ref.parent.parent?.id)).filter(Boolean)
  } catch (e) {
    console.error('[recommend] liked-trips lookup failed (non-fatal)', e?.message || e)
    return []
  }
}

// Popularity + recency fallback (new users / no embeddings / no pgvector).
async function popular(db, uid, limit) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM trips
     WHERE ($1::text IS NULL OR user_uid <> $1)
     ORDER BY like_count DESC, created_at DESC
     LIMIT $2`,
    [uid, limit]
  )
  return rows.map(r => ({ ...r, reason: r.like_count > 0 ? 'popular' : 'new' }))
}

// Top trips for a user. Always returns an array (never throws).
export async function recommendForUser(db, uid, { limit = 30 } = {}) {
  if (!uid) return popular(db, uid, limit)

  try {
    // Taste sources: own trips + liked trips.
    const { rows: own } = await db.query('SELECT id FROM trips WHERE user_uid = $1', [uid])
    const tasteIds = [...new Set([...own.map(r => r.id), ...(await likedTripIds(uid))])]
    if (!tasteIds.length) return popular(db, uid, limit)

    // Centroid of the available embeddings (pgvector avg). Null if none embedded.
    const { rows: [t] } = await db.query(
      `SELECT avg(embedding)::text AS taste FROM trips
       WHERE id = ANY($1::int[]) AND embedding IS NOT NULL`,
      [tasteIds]
    )
    if (!t?.taste) return popular(db, uid, limit)

    // Nearest public trips by cosine distance, excluding self-authored + already
    // seen (liked/created).
    const { rows } = await db.query(
      `SELECT ${COLS} FROM trips
       WHERE user_uid <> $1
         AND embedding IS NOT NULL
         AND id <> ALL($2::int[])
       ORDER BY embedding <=> $3::vector
       LIMIT $4`,
      [uid, tasteIds, t.taste, limit]
    )
    return rows.map(r => ({ ...r, reason: 'foryou' }))
  } catch (e) {
    // pgvector unavailable or query error — fall back to popularity.
    console.error('[recommend] vector search failed, using popularity:', e?.message || e)
    return popular(db, uid, limit)
  }
}
