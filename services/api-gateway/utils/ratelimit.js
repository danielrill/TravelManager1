// Token-bucket rate limiter, keyed PER CALLER (uid), backed by Redis so the
// limit is enforced ACROSS gateway replicas. The previous in-memory map gave an
// effective limit of replicas × rate (each replica had its own bucket); a shared
// Redis bucket fixes that under HPA scale-out.
//
// The refill + take is done atomically in a Lua script (no read-modify-write
// race between replicas). Server TIME is used as the clock so replica skew can't
// hand out extra tokens. FAILS OPEN: any Redis error → allow the request (a
// rate limiter must never take the gateway down).
import { getRedis } from '@travelmanager/shared/cache'

// KEYS[1] = bucket key. ARGV[1] = capacity (rate/min). ARGV[2] = key TTL (sec).
// Returns 1 (allowed) or 0 (denied).
const BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local refill_per_sec = capacity / 60.0

local t = redis.call('TIME')
local now = tonumber(t[1]) + (tonumber(t[2]) / 1000000.0)

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

tokens = math.min(capacity, tokens + (now - ts) * refill_per_sec)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)
return allowed
`

// A bucket needs `capacity / rate` = 60s to refill from empty; 120s TTL lets
// idle buckets evict without truncating an in-progress refill.
const BUCKET_TTL_SEC = 120

export async function allow(key, ratePerMin) {
  const redis = getRedis()
  if (!redis) return true   // cache disabled — fail open

  try {
    const res = await redis.eval(BUCKET_LUA, 1, `rl:${key}`, ratePerMin, BUCKET_TTL_SEC)
    return res === 1
  } catch {
    // Redis unreachable / script error — never block traffic on the limiter.
    return true
  }
}
