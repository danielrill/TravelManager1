// GET /api/metrics — Prometheus exposition scraped by Google Managed Prometheus
// at the pod level (not routed through the public gateway).
import { metricsText, register } from '@travelmanager/shared/metrics'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', register.contentType)
  return await metricsText()
})
