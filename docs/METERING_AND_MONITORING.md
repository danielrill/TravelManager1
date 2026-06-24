# Usage-Based Pricing + Monitoring — App + IaC Handoff

This document covers the metering/pricing + Prometheus/Grafana work landed in the
**app monorepo**, and the **TravelManagerIaC** (Terraform + Flux) changes still
required to run it in production. The app code is complete and tested; the IaC
section is a checklist for the infra repo.

---

## 1. What shipped in this repo (app)

### Billing (exact, event-sourced)
- `packages/shared/rating.js` — pure pricing engine. `computeCost(usage, rateCard)` =
  `Σ (base_fee + max(0, used − included) × unit_rate)`. Plan cards + per-tenant
  overrides via `resolveRateCard`.
- `packages/shared/metering.js` — emit helpers:
  - `recordUsage(tenantId, dimension, qty, {idempotencyKey, plan})` — **direct** Pub/Sub
    emit (low-volume, high-value units).
  - `bumpUsageCounter(redis, tenantId, dimension)` — **Redis aggregation** (high-volume
    `api_request`).
  - `flushUsageCounters(redis)` — cron drains Redis → one `UsageRecorded` per tenant/dimension.
- `services/metering-service/` — new Nitro service. Subscribes `UsageRecorded`,
  idempotent insert + rollup (`utils/ingest.js`), owns rate cards + invoices, serves
  tenant/admin billing APIs. **Billing data is centralised on the shared DB** keyed by
  `tenant_id` (control-plane concern; the operator bills across all tenants and this
  service is a shared singleton — no per-tenant-pod schema bootstrap, no cross-pod fan-out).

### Meter dimensions + emit points
| Dimension | Strategy | Emitted from |
|---|---|---|
| `api_request` | Redis counter, cron-flushed | `services/api-gateway/routes/[...].js` → `utils/usage-meter.js` |
| `ai_recommendation` | direct emit (personalized "foryou" only) | `services/trip-service/api/trips/recommended.get.js` |
| `trip_created` | direct emit (id = idempotency key) | `services/trip-service/api/trips/index.post.js` |
| `active_seat` | daily cron snapshot (gauge) | `services/metering-service/api/tasks/seat-snapshot.post.js` |

Free tier (`default`) is unmetered everywhere (guarded in `recordUsage` / the gateway).

### Idempotency
`usage_events UNIQUE(tenant_id, idempotency_key)` + counter rollup **only on real insert**
⇒ Pub/Sub at-least-once redelivery never double-counts. Keys: `trip:<id>`,
`rec:<uid>:<ts>`, `flush:<tenant>:<dim>:<window>`, `seat:<tenant>:<period>:<day>`.

### Billing API (via gateway routes already added to `routing.js`)
- `GET /api/usage/current` — tenant: own usage + projected cost (tenant subdomain).
- `GET /api/admin/rate-cards`, `PUT /api/admin/rate-cards/:plan`,
  `PUT /api/admin/rate-cards/overrides/:tenantId`, `GET /api/admin/usage/:tenantId` —
  operator only (admin host + `x-role=admin`).

### Monitoring (operational, sampled — NOT the billing source of truth)
- `packages/shared/metrics.js` — `prom-client` registry: default Node metrics +
  `http_requests_total`, `http_request_duration_seconds`, `usage_events_total`.
- Every service exposes metrics + records RED via `middleware/metrics.js`:
  - app services: `GET /api/metrics` (api/ dir)
  - **api-gateway: `GET /metrics`** (routes/ dir — `/api/*` is the proxy catch-all)
- `prom-client@^15` added to `packages/shared/package.json`.

### Tests
`tests/unit/rating.test.js`, `metering.test.js`, `usage-meter.test.js` — 23 tests.
Full suite: 152 passing. metering-service, api-gateway, trip-service all `nitro build` clean.

---

## 2. TODO in TravelManagerIaC (Terraform + Flux)

### 2a. Pub/Sub (Terraform — extend the existing `pubsub.tf`)
```hcl
# Topic + DLQ, mirroring TripCreated/NewsletterReady.
resource "google_pubsub_topic" "usage_recorded"      { name = "UsageRecorded" }
resource "google_pubsub_topic" "usage_recorded_dlq"  { name = "UsageRecorded-dlq" }

resource "google_pubsub_subscription" "metering_usage" {
  name  = "metering-usage-sub"
  topic = google_pubsub_topic.usage_recorded.name
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.usage_recorded_dlq.id
    max_delivery_attempts = 5
  }
  retry_policy { minimum_backoff = "5s" maximum_backoff = "300s" }
}
# Optional push variant → https://<metering-service>/api/events/usage
```
No new IAM: the runtime GSA `travelmanager-gke` already has
`roles/pubsub.publisher` + `roles/pubsub.subscriber`. The gateway publishes; the
metering-service subscribes — both run under that GSA.

### 2b. Helm — add the metering-service workload
Copy the notification-service template (Deployment + Service + HPA + ServiceAccount WI).
- container port 8080, probes `/api/health` (liveness) + `/api/ready` (readiness)
- env: `USAGE_SUB=metering-usage-sub`, `DATABASE_URL` (shared Cloud SQL — same as
  user-service; metering tables live on the shared DB), `USER_SERVICE_URL`,
  `GOOGLE_CLOUD_PROJECT`. Cloud SQL Auth Proxy sidecar like the other DB services.
- Add `METERING_SERVICE_URL=http://metering-service:8080` to the **api-gateway** env so
  the gateway can route `/api/usage` + `/api/admin/rate-cards` + `/api/admin/usage`.

### 2c. CronJobs (mirror the existing poll-weather/poll-warnings CronJobs)
| Job | Schedule | Target |
|---|---|---|
| `flush-usage` | `* * * * *` (every 1 min) | `POST http://api-gateway:8080/tasks/flush-usage` |
| `seat-snapshot` | `@daily` | `POST http://metering-service:8080/api/tasks/seat-snapshot` |
| `period-rollup` | `0 1 1 * *` (1st of month) | `POST http://metering-service:8080/api/tasks/period-rollup` |

> ⚠️ The curl pods MUST carry the label `app.kubernetes.io/part-of: travelmanager`
> or the NetworkPolicy drops the request (curl exit 28) — same gotcha as the
> existing cron jobs.
> Note `flush-usage` is on the gateway at **`/tasks/...`** (not `/api/...`), so it is
> not reachable through the public proxy — the CronJob hits the pod directly.

### 2d. Google Managed Prometheus + Grafana
- Enable managed-collection on the Autopilot cluster (default-on for recent Autopilot;
  otherwise set `monitoring_config { managed_prometheus { enabled = true } }` on the
  `google_container_cluster`).
- Add `PodMonitoring` CRs scraping the app pods. **Two paths** (because the gateway is
  at root, app services under /api):
  ```yaml
  # app services (user/trip/destination/social/travel-info/notification/provisioner/metering)
  apiVersion: monitoring.googleapis.com/v1
  kind: PodMonitoring
  metadata: { name: travelmanager-services }
  spec:
    selector: { matchLabels: { app.kubernetes.io/part-of: travelmanager } }
    endpoints: [{ port: 8080, path: /api/metrics, interval: 30s }]
  ---
  # api-gateway only
  kind: PodMonitoring
  metadata: { name: travelmanager-gateway }
  spec:
    selector: { matchLabels: { app.kubernetes.io/name: api-gateway } }
    endpoints: [{ port: 8080, path: /metrics, interval: 30s }]
  ```
- Grafana: deploy in-cluster (Helm) or reuse existing; add the **Google Cloud Monitoring /
  GMP datasource** (grant the Grafana GSA `roles/monitoring.viewer`). Dashboards: RED
  (rate/error/latency from `http_requests_total` + `http_request_duration_seconds`),
  per-plan usage (`usage_events_total`), pod/HPA health, subscriber lag (metering
  `/api/control`).
- Cloud Monitoring alert policies: error rate, p99 latency, `UsageRecorded-dlq` depth,
  metering subscriber stalled (`usage_events_total` flat while traffic flows).

---

## 3. Local verification (no GCP)
```bash
# run the new unit tests
npx vitest run tests/unit/rating.test.js tests/unit/metering.test.js tests/unit/usage-meter.test.js

# end-to-end against a local Postgres (PUBSUB_DISABLED=1):
#  1. start metering-service (port 3007), POST /api/events/usage with a base64
#     UsageRecorded message → row in usage_events, usage_counters incremented.
#  2. re-POST the SAME message → counter unchanged (idempotency).
#  3. GET /api/usage/current (x-tenant-id: tui, x-plan: standard) → projected cost.
#  4. curl :3007/api/metrics → Prometheus text incl. usage_events_total.
```
