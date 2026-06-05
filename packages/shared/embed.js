// Shared text-embedding helper — Vertex AI text-embedding-005 (768-dim).
//
// Design rule (mirrors cache.js / pubsub.js): embeddings are an enhancement,
// never a hard dependency. Every call FAILS OPEN — no GCP project, VERTEX_DISABLED=1,
// or any API error returns null (embedBatch returns nulls). Callers store the
// null and a backfill job fills it later, so local dev / CI stay green without
// GCP credentials.
import { GoogleAuth } from 'google-auth-library'

export const EMBED_DIM = 768
const MODEL = 'text-embedding-005'

let _auth = null
let _disabled = false

function project() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID || null
}
function location() {
  return process.env.VERTEX_LOCATION || 'europe-west1'
}

function getAuth() {
  if (_disabled) return null
  if (_auth) return _auth
  if (process.env.VERTEX_DISABLED === '1' || !project()) {
    _disabled = true
    return null
  }
  _auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  return _auth
}

// Format a JS number[] as a pgvector literal: '[0.1,0.2,...]'. Returns null for
// empty/invalid input so callers can store SQL NULL.
export function toVectorLiteral(values) {
  if (!Array.isArray(values) || !values.length) return null
  return `[${values.join(',')}]`
}

// Embed up to ~250 texts in one Vertex predict call. Returns an array aligned
// with the input: each entry is a number[768] or null (on per-call failure all
// entries are null). Never throws.
export async function embedBatch(texts) {
  const list = (texts || []).map(t => String(t ?? '').trim())
  if (!list.length) return []
  const auth = getAuth()
  if (!auth) {
    console.log(`[embed] (disabled — no Vertex creds) would embed ${list.length} text(s)`)
    return list.map(() => null)
  }
  try {
    const url = `https://${location()}-aiplatform.googleapis.com/v1/projects/${project()}/locations/${location()}/publishers/google/models/${MODEL}:predict`
    const client = await auth.getClient()
    const res = await client.request({
      url,
      method: 'POST',
      data: {
        instances: list.map(content => ({ content })),
        parameters: { outputDimensionality: EMBED_DIM },
      },
    })
    const preds = res?.data?.predictions || []
    return list.map((_, i) => preds[i]?.embeddings?.values ?? null)
  } catch (e) {
    console.error('[embed] Vertex predict failed (failing open to null):', e?.message || e)
    return list.map(() => null)
  }
}

// Embed a single text. Returns number[768] or null. Never throws.
export async function embed(text) {
  const [v] = await embedBatch([text])
  return v ?? null
}
