// Trip embedding helpers. Builds the text fed to Vertex AI and returns a
// pgvector literal ready to bind as $N::vector. Fails open: null when embeddings
// are unavailable (no creds / API error) — the backfill cron fills it later.
import { embed, toVectorLiteral } from '@travelmanager/shared/embed'

// The natural-language representation of a trip used for semantic similarity.
export function tripText(trip) {
  return [
    trip.title,
    trip.destination,
    trip.dest_country,
    trip.short_description,
    trip.detail_description,
  ].filter(Boolean).join('. ')
}

// Embed a trip → pgvector literal string (or null). Never throws.
export async function embedTrip(trip) {
  const values = await embed(tripText(trip))
  return toVectorLiteral(values)
}

// Compute and persist a trip's embedding. No-op if embedding is unavailable.
// Caller should .catch() — references the `embedding` column, which is absent if
// pgvector setup was skipped.
export async function updateTripEmbedding(db, trip) {
  const literal = await embedTrip(trip)
  if (!literal) return false
  await db.query('UPDATE trips SET embedding = $1::vector WHERE id = $2', [literal, trip.id])
  return true
}
