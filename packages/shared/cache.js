// Shared Redis cache layer. One client per process, lazily created from
// REDIS_URL (12-Factor: config from the environment only). Mirrors the
// lazy-singleton shape of db.js.
//
// Design rule: the cache is a performance optimisation, never a correctness or
// availability dependency. Every operation FAILS OPEN — a missing REDIS_URL, an
// unreachable Redis, or any client error degrades to "cache miss" and the caller
// falls through to Postgres. Nothing here ever throws into the request path.
import Redis from 'ioredis'

let _redis = null
let _disabled = false

export function getRedis() {
  if (_disabled) return null
  if (_redis) return _redis

  const url = process.env.REDIS_URL
  if (!url) {
    // No Redis configured — cache disabled, everything fails open.
    _disabled = true
    return null
  }

  _redis = new Redis(url, {
    lazyConnect: true,
    // Don't let queued commands pile up while disconnected — fail fast to DB.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    // Keep retrying the connection in the background, capped backoff.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  })

  // Log the first error then stay quiet; ioredis reconnects on its own. Without
  // a handler an 'error' event would crash the process.
  let logged = false
  _redis.on('error', (err) => {
    if (!logged) {
      console.error('[cache] redis error (failing open to DB):', err.message)
      logged = true
    }
  })
  _redis.on('ready', () => { logged = false })

  // lazyConnect: kick off the connection without awaiting it.
  _redis.connect().catch(() => {})

  return _redis
}

// Read-through cache. Returns the cached JSON value on hit; on miss or ANY
// error runs loader(), caches its result (fire-and-forget, TTL in seconds), and
// returns it.
export async function cached(key, ttlSec, loader) {
  const redis = getRedis()
  if (!redis) return loader()

  try {
    const hit = await redis.get(key)
    if (hit != null) return JSON.parse(hit)
  } catch {
    // Read failed — fall through to the loader.
    return loader()
  }

  const value = await loader()
  // Don't cache null/undefined (treat as "no row" — let it re-resolve).
  if (value != null) {
    redis.set(key, JSON.stringify(value), 'EX', ttlSec).catch(() => {})
  }
  return value
}

// Delete specific keys. Swallows errors.
export async function invalidate(...keys) {
  if (!keys.length) return
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(...keys)
  } catch {
    // Best-effort — a failed bust just means a stale entry expires on its TTL.
  }
}

// Delete every key matching `<prefix>*` via a non-blocking SCAN. Swallows errors.
export async function invalidatePattern(prefix) {
  const redis = getRedis()
  if (!redis) return
  try {
    const stream = redis.scanStream({ match: `${prefix}*`, count: 100 })
    for await (const batch of stream) {
      if (batch.length) await redis.del(...batch)
    }
  } catch {
    // Best-effort.
  }
}
