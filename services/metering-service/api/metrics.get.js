// GET /metrics — Prometheus exposition scraped by Google Managed Prometheus.
import { metricsText, register } from '@travelmanager/shared/metrics'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', register.contentType)
  return await metricsText()
})
