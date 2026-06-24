import { readiness } from '../utils/ready.js'

// Readiness probe. 503 until the schema is bootstrapped so traffic + the
// subscriber stay off the pod until its tables exist. Liveness stays 200.
export default defineEventHandler((event) => {
  if (!readiness.dbReady) {
    setResponseStatus(event, 503)
    return { status: 'starting', service: 'metering-service', dbReady: false }
  }
  return { status: 'ok', service: 'metering-service', dbReady: true }
})
