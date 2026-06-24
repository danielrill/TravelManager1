// GET /metrics — Prometheus exposition scraped by Google Managed Prometheus.
// Outside /api so it isn't routed through the proxy pipeline.
import { metricsText, register } from '@travelmanager/shared/metrics'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', register.contentType)
  return await metricsText()
})
