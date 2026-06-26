// Authenticate internal callers to the provisioner's /api/internal/* endpoints.
// These create/destroy per-tenant Postgres pods, databases and app Deployments —
// expensive, privileged operations. The NetworkPolicy is the first gate (only
// in-mesh pods can reach this Service); this shared-secret check is defence in
// depth so a breached network boundary still can't drive provisioning.
//
// Fail-open ONLY when no token is configured (local/dev, where the optional
// secretKeyRef leaves PROVISIONER_INTERNAL_TOKEN empty). Once a token is set
// (prod, via the provisioner-internal-token ExternalSecret) every call MUST carry
// a matching x-internal-token header or it is rejected.
import { timingSafeEqual } from 'node:crypto'

let warned = false

function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  // timingSafeEqual throws on length mismatch — guard so a wrong-length token is a
  // clean reject, not a 500, and still constant-time for equal lengths.
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export default defineEventHandler((event) => {
  if (!event.path?.startsWith('/api/internal/')) return

  const expected = process.env.PROVISIONER_INTERNAL_TOKEN || ''
  if (!expected) {
    if (!warned) {
      console.warn('[provisioner] PROVISIONER_INTERNAL_TOKEN unset — internal endpoints are unauthenticated (dev mode; network policy is the only gate)')
      warned = true
    }
    return
  }

  const provided = getHeader(event, 'x-internal-token') || ''
  if (!safeEqual(provided, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
