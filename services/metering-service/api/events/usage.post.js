// POST /api/events/usage — Pub/Sub PUSH target for UsageRecorded (internal).
// Mirrors notification-service's push endpoint. Used when the subscription is
// configured for push delivery instead of pull.
import { handleUsage } from '../../utils/ingest.js'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const msg = body?.message
  if (!msg?.data) return { ok: true, skipped: 'no message' }
  let payload
  try {
    payload = JSON.parse(Buffer.from(msg.data, 'base64').toString())
  } catch (e) {
    console.error('[metering-service] dropping unparseable usage message', e)
    return { ok: true, dropped: 'unparseable' }
  }
  await handleUsage(payload)
  return { ok: true }
})
