// Shared Prometheus instrumentation. One prom-client registry per process with
// default Node/process metrics plus HTTP RED metrics (Rate, Errors, Duration) and
// a usage counter mirrored from the billing meter so Grafana shows live usage
// alongside ops. Scraped by Google Managed Prometheus via a PodMonitoring CR at
// GET /metrics on each service (port 8080).
//
// This is OPERATIONAL telemetry — sampled, lossy-tolerant, NOT the billing source
// of truth (that's the Pub/Sub → Postgres path in metering-service). Keep label
// cardinality bounded: route is a coarse pattern, tenant is only attached on the
// gateway where it matters and is dropped elsewhere.
import client from 'prom-client'

let _inited = false

export const register = client.register

// Idempotent: register default + custom metrics once per process. Safe to call
// from every service's plugin. `serviceName` becomes a constant label so a single
// GMP target set is sliceable by service.
export function initMetrics(serviceName) {
  if (_inited) return register
  _inited = true
  register.setDefaultLabels({ service: serviceName || process.env.SERVICE_NAME || 'unknown' })
  client.collectDefaultMetrics({ register })
  return register
}

// Lazy metric singletons (getOrCreate so test reloads / double-init don't throw
// "metric already registered").
function counter(name, help, labelNames) {
  return register.getSingleMetric(name) || new client.Counter({ name, help, labelNames, registers: [register] })
}
function histogram(name, help, labelNames, buckets) {
  return register.getSingleMetric(name) || new client.Histogram({ name, help, labelNames, buckets, registers: [register] })
}

export const httpRequestsTotal = () =>
  counter('http_requests_total', 'HTTP requests by route/method/status/plan', ['method', 'route', 'status', 'plan'])

export const httpRequestDuration = () =>
  histogram('http_request_duration_seconds', 'HTTP request duration', ['method', 'route', 'status'],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5])

export const usageEventsTotal = () =>
  counter('usage_events_total', 'Billable usage units metered', ['dimension', 'plan'])

// Collapse a path to a low-cardinality route label: keep the first two segments,
// replace anything that looks like an id with ':id'. '/api/trips/42' → '/api/trips/:id'.
export function routeLabel(path) {
  const bare = String(path || '').split('?')[0]
  const segs = bare.split('/').filter(Boolean).slice(0, 3)
  const norm = segs.map((s) => (/^\d+$/.test(s) || /[0-9a-f]{8,}/i.test(s) ? ':id' : s))
  return '/' + norm.join('/')
}

// Record one HTTP request. plan defaults to '' (unknown / not the gateway).
export function recordHttp({ method, path, status, plan = '', durationSec } = {}) {
  const route = routeLabel(path)
  httpRequestsTotal().inc({ method: method || 'GET', route, status: String(status || 0), plan })
  if (typeof durationSec === 'number') {
    httpRequestDuration().observe({ method: method || 'GET', route, status: String(status || 0) }, durationSec)
  }
}

// Record one billable usage unit (mirror of the Pub/Sub meter, for dashboards).
export function recordUsageMetric(dimension, plan = '', qty = 1) {
  usageEventsTotal().inc({ dimension, plan }, Number(qty) || 0)
}

// h3/Nitro middleware factory: times every request and records RED metrics on
// response finish. Drop into each service as middleware/metrics.js.
export function httpMetricsMiddleware(serviceName) {
  initMetrics(serviceName)
  return (event) => {
    const start = process.hrtime.bigint()
    const req = event.node?.req
    const res = event.node?.res
    if (!res || typeof res.on !== 'function') return
    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9
      recordHttp({
        method: req?.method,
        path: event.path || req?.url,
        status: res.statusCode,
        plan: req?.headers?.['x-plan'] || '',
        durationSec,
      })
    })
  }
}

// Plain-text exposition for GET /metrics.
export async function metricsText() {
  return register.metrics()
}
