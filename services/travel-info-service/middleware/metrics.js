import { httpMetricsMiddleware } from '@travelmanager/shared/metrics'

export default defineEventHandler(httpMetricsMiddleware('travel-info-service'))
