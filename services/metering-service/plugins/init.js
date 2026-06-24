// Bootstrap: init schema (retrying on cold-start DB races), then start the pull
// subscriber for UsageRecorded (unless Pub/Sub disabled). Push delivery is also
// available via POST /api/events/usage.
import { bootstrapSchema } from '@travelmanager/shared/schema-bootstrap'
import { initMetrics } from '@travelmanager/shared/metrics'
import { initMeteringDb } from '../utils/schema.js'
import { handleUsage } from '../utils/ingest.js'
import { control } from '../utils/control.js'
import { readiness } from '../utils/ready.js'

export default defineNitroPlugin(async () => {
  initMetrics('metering-service')

  // Don't start the subscriber until the schema exists — the handler INSERTs rows.
  const ok = await bootstrapSchema('metering-service', initMeteringDb, { readiness })
  if (!ok) return

  if (process.env.PUBSUB_DISABLED === '1') {
    console.log('[metering-service] Pub/Sub disabled — subscriber not started')
    return
  }

  const { createSubscriber } = await import('@travelmanager/shared/pubsub')
  createSubscriber(process.env.USAGE_SUB || 'metering-usage-sub', handleUsage)
  control.usage.subscriberUp = true
  console.log('[metering-service] usage subscriber started')
})
