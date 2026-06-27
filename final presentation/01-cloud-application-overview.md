# TravelManager — Cloud Application Overview

*Final presentation document. Companion: `02-deployment-and-push-workflow.md`.*

---

## 1. What it is

**TravelManager** is a multi-tenant SaaS travel-planning platform. Users create
trips, plan multi-stop routes on an interactive map, follow each other, get a
personalized feed + weekly newsletter, and receive travel-warning / weather
alerts. It is sold as a white-label product: each customer (a travel agency,
"tenant") gets its own branded subdomain (`tui.onecloudaway.de`).

The system runs as **microservices on GKE Autopilot**, deployed by **GitOps
(Flux)**, secured east-west by a **managed Cloud Service Mesh (Istio)**, and
backed by Cloud SQL, Firestore, Memorystore Redis, and Pub/Sub. Two source repos:

| Repo | Holds |
|------|-------|
| `TravelManager` | Application: Nuxt frontend + 9 Node/Nitro microservices + shared lib + Helm-consumed Dockerfiles |
| `TravelManagerIaC` | Infrastructure: Terraform (GKE/SQL/IAM/PubSub/…), Helm chart, Flux GitOps config, mesh manifests |

---

## 2. Tech stack

**Frontend**
- Nuxt 3.13 + Vue 3, served by Nitro (Node 22), built with Vite.
- SPA-style (`ssr: false`); client-side auth + tenant resolution.
- Libraries: Firebase SDK (auth), `globe.gl` (3D map), Google Maps JS SDK.
- Container: `Dockerfile` → `.output/server/index.mjs`, port 8080.

**Backend** — 9 services, all the same shape:
- JavaScript / **Node.js (ESM)** on the **Nitro** micro-framework (file-based routing under `api/`).
- Internal port **8080**; one generic build: `Dockerfile.service` (multi-stage, `docker build --build-arg SERVICE=<name>`).
- Key deps: `pg` (Postgres), `firebase-admin` (JWT verify), `@google-cloud/pubsub`, `ioredis`, `prom-client`, `h3`.

**Shared library** — `packages/shared/` (npm workspace, imported by every service):

| Module | Responsibility |
|--------|----------------|
| `db.js` | Shared Postgres pool |
| `tenant-db.js` | Per-tenant pool routing (`poolForTenant`, `forEachTenant`) |
| `firebase.js` | Firebase Admin SDK (token verify) |
| `identity.js` | Parse gateway-injected `x-user-uid` / `x-tenant-id` headers |
| `pubsub.js` | Publish / subscribe wrappers |
| `tiers.js` | Plan definitions (free / standard / enterprise) |
| `trace.js` | Istio/B3/W3C trace-header propagation across `$fetch` calls |
| `metrics.js` | Prometheus instrumentation |
| `cache.js`, `metering.js`, `geocode.js`, `embed.js` | Redis, usage billing, geocoding, Vertex AI embeddings |

Root is an npm-workspaces monorepo (`workspaces: [packages/*, services/*]`, `type: module`).

---

## 3. Microservices

10 deployables (9 backend + frontend). **Sync** = request/response behind the
gateway; **Worker** = Pub/Sub-driven background processor.

| Service | Kind | Purpose | Database | Key endpoints |
|---------|------|---------|----------|---------------|
| **api-gateway** | sync (edge) | Single entry point: JWT verify, rate-limit, feature-gate by plan, tenant resolve, route to services | — (Redis state) | `/api/*` proxy, `/healthz`, `/metrics` |
| **user-service** | sync | Auth, users, tenant management (self-serve + admin) | `travelmanager_user` | `/api/users/*`, `/api/tenants/self-serve`, `/api/internal/tenants/by-host/[sub]` |
| **trip-service** | sync | Trip CRUD, plan locations, travel plans, reviews, geocoding, recs | `travelmanager_trip` (+ Firestore) | `/api/trips`, `/api/travel-plans/[tripId]`, `/api/trips/recommended` |
| **destination-service** | sync | Destination catalog, routes, transport/accommodation, B2B traveler data | `travelmanager_destination` | `/api/destinations`, `/api/b2b/destinations/[id]/travelers` |
| **provisioner-service** | sync (control) | On-demand per-tenant Kubernetes provisioning (Postgres pod + app pods + DBs) | k8s API | `/api/internal/provision-tenant`, `/deprovision-tenant` |
| **social-service** | worker | Personalized feed, follow graph, weekly newsletter | `travelmanager_social` | `/api/feed`, `/api/feed/follows/[uid]`, sub: TripCreated/Updated |
| **travel-info-service** | worker | Travel-warning + weather pollers, alert diff engine | `travelmanager_travelinfo` | `/api/alerts`, `/api/weather`, pub: TravelAlert |
| **notification-service** | worker | Alert + newsletter email delivery | `travelmanager_notification` | sub: TravelAlert, NewsletterReady |
| **metering-service** | worker | Idempotent usage drain, billing rollups | `travelmanager_metering` | sub: UsageRecorded |
| **frontend** | sync (edge) | Nuxt web UI | — | `/` (SPA) |

The **gateway** is the only public backend: it extracts the subdomain from the
`Host` header, resolves the tenant + plan, injects `x-tenant-id` / `x-plan` /
`x-role`, enforces the per-plan rate limit, and proxies to the right service.

---

## 4. Data layer

- **Cloud SQL — PostgreSQL 16** (`travelmanager-postgres`, `db-custom-1-3840`). **DB-per-service** boundary, 7 logical databases (user, trip, destination, social, travel-info, notification, metering).
- **Firestore** — social signals that don't need SQL: trip review comments + likes (via Firebase Admin SDK).
- **Memorystore Redis 7.2** (BASIC, fail-open) — cache, multi-replica gateway state (rate limits, tenant resolution).
- **pgvector** — Vertex AI embeddings for trip recommendations (run `CREATE EXTENSION vector` before prod, else recs fall back to popularity-only).
- **PgBouncer** — 2 replicas, transaction pooling on `:6432`, `max_db_connections: 80`, in front of the **Cloud SQL Auth Proxy** (`:5432`). Keeps total Cloud SQL connections bounded as pods scale.

Each service owns its schema and bootstraps it idempotently at startup
(`api/internal/provision.post.js`); the same endpoint is called during tenant
provisioning.

---

## 5. Event backbone (Pub/Sub)

Async work is decoupled over **5 topics**, each with a **dead-letter queue** (5
retries, exponential backoff):

```
TripCreated / TripUpdated  → social-service (feed fan-out)
TravelAlert                → notification-service (email)
NewsletterReady            → notification-service (email)
UsageRecorded              → metering-service (billing drain)
```

Workers have **no liveness probe** (subscribers should stay up) and a readiness
probe gated on schema bootstrap. CronJobs feed the pipeline (poll warnings/weather,
build newsletter, flush usage, embedding backfill).

---

## 6. Multitenancy — free vs standard *(key section)*

### Tenant resolution
1. Request hits gateway as `tenant.onecloudaway.de`.
2. Gateway extracts the subdomain, calls user-service `/api/internal/tenants/by-host/[sub]`.
3. Gateway injects `x-tenant-id`, `x-plan`, `x-role` downstream.
4. Each service calls `tenantDb(event)` (`packages/shared/tenant-db.js`) to get the right Postgres pool.

### Free tier (`default` tenant)
- **Shared Cloud SQL.** Isolation is **row-level** by `tenant_id` / `user_uid`.
- Rate limit **60 req/min**.
- No feed, no newsletter, no white-label, no B2B data.

### Standard / Enterprise tier
- **Dedicated Postgres pod per tenant.** The **provisioner-service** creates, via the Kubernetes API:
  1. Preflight **NEG-quota check** (GKE NETWORK_ENDPOINT_GROUPS limit ~100; ~18–21 NEGs/tenant).
  2. A `StatefulSet postgres-<tenantId>` with its own PVC (sidecar injection **off** — isolated by NetworkPolicy, not in the mesh).
  3. Per-service databases on that pod (`travelmanager_trip`, `travelmanager_social`).
  4. Schema bootstrap via each isolated service's `/api/internal/provision`.
  5. Dedicated **trip-service** + **social-service** app pods for that tenant (each with its own HPA, 1→2).
  6. A **NetworkPolicy** isolating the tenant's pods.
- Rate limit **600 req/min** (standard) / **6000** (enterprise).
- Feed + newsletter + white-label; enterprise adds B2B traveler-data API.
- **Control-plane services stay shared** (user, destination, travel-info, notification); only trip + social get dedicated per-tenant pods.

`tenant-db.js` lazily creates and caches a pool per tenant; `forEachTenant()`
lets cron work iterate the `default` tenant plus every provisioned pod.

```
            free tenant                         standard tenant "tui"
  ┌───────────────────────────┐      ┌──────────────────────────────────────┐
  │ shared trip/social pods    │      │ trip-tui pod   social-tui pod         │
  │ shared Cloud SQL (row-LSO) │      │        ↓             ↓                │
  └───────────────────────────┘      │   postgres-tui StatefulSet (own PVC)  │
                                      │   NetworkPolicy-isolated              │
                                      └──────────────────────────────────────┘
        (provisioner-service creates the right column on tenant create)
```

---

## 6b. Usage metering & billing

Standard/Enterprise tenants are billed **usage-based**; the **metering-service**
worker owns the ledger. Free tenants (`tenant_id = 'default'`) are never metered.

### Billing dimensions (`packages/shared/rating.js`)
| Dimension | Metered on | Aggregation |
|-----------|-----------|-------------|
| `api_request` | every gateway HTTP call | sum |
| `ai_recommendation` | personalized "For You" results only (not popularity fallback) | sum |
| `active_seat` | daily active-user count | **gauge** (overwrite, not sum) |
| `trip_created` | user creates a trip | sum |

### Flow — request → invoice
1. **Record.** High-volume `api_request` is bumped fire-and-forget in Redis at the gateway (`services/api-gateway/utils/usage-meter.js`, key `usage:{tenant}:{YYYY-MM}`). Low-volume dims emit a Pub/Sub event directly with an idempotency key (`packages/shared/metering.js` `recordUsage`).
2. **Flush.** `flush-usage` cron (every 60s) atomically read-and-resets the Redis hash (Lua) → one aggregated **`UsageRecorded`** event per tenant/dimension. Collapses millions of requests into a handful of messages; idempotency key `flush:{tenant}:{dim}:{ts}`.
3. **Ingest.** metering-service subscribes to `metering-usage-sub`. One transaction: `INSERT … ON CONFLICT (tenant_id, idempotency_key) DO NOTHING` into the immutable `usage_events` ledger, then bump `usage_counters` only if the insert was new — redeliveries never double-count (`services/metering-service/utils/ingest.js`).
4. **Seats.** `seat-snapshot` cron (daily 00:00) counts tenant members → emits `active_seat` as a gauge.
5. **Invoice.** `period-rollup` cron (1st of month 01:00) prices the prior month at effective rates and upserts an immutable `invoices` row (`total_cents` + `lines` JSONB frozen). Cost per dim = `base_fee + max(0, used − included) × unit_rate` (`rating.js`).

### Pricing model (`packages/shared/tiers.js`, seeded `rate_cards`)
- **Free** — unmetered; no feed/recs.
- **Standard** — one-time **€29.99** setup, then 100% usage-based (1M api_request + 5K ai_recommendation + 5 seats included).
- **Enterprise** — base fee + higher included quotas (10M / 100K / 50 seats); per-tenant custom pricing via `tenant_rate_overrides`.

### Tables (`travelmanager_metering`)
`usage_events` (immutable ledger, UNIQUE `tenant_id,idempotency_key`) ·
`usage_counters` (pre-aggregated read model) ·
`rate_cards` (versioned by `effective_from`) ·
`tenant_rate_overrides` (enterprise) ·
`invoices` (frozen monthly bills).

---

## 6c. AI trip recommendations

Semantic "For You" recommendations via vector similarity, with a **fail-open
fallback to popularity** so the feature degrades gracefully.

### Write path — embeddings
- On trip create/update, `updateTripEmbedding` builds text from title/destination/description and calls **Vertex AI `text-embedding-005`** (768-dim) via `packages/shared/embed.js`. Result stored in the `trips.embedding` `vector(768)` column.
- **Never throws** — on Vertex/auth failure the embedding is stored `null`.
- `backfill-embeddings` cron (every 6h, per tenant via `forEachTenant()`) fills up to 200 trips/run where `embedding IS NULL`, batch-embedded in one call.

### Vector storage
- `trips.embedding` indexed with **IVFFlat** (`vector_cosine_ops`, 100 lists). If pgvector isn't installed (`CREATE EXTENSION vector` missing), embeddings stay null and the engine falls back to popularity.

### Read path — `GET /api/trips/recommended`
1. Collect the user's taste signal: trips they **created** + trips they **liked** (Firestore collectionGroup).
2. Compute the **centroid** of those embeddings (`avg(embedding)`).
3. Nearest-neighbour query by **cosine distance**: `ORDER BY embedding <=> $centroid LIMIT 30`, excluding self-authored / already-seen.
4. Each result tagged `reason: 'foryou'` (semantic) or `'popular'`/`'new'` (fallback).
5. **Fallback** to `like_count DESC, created_at DESC` if no taste signal / no embeddings / pgvector query fails.

Metering: one `ai_recommendation` unit recorded only when results contain a
`foryou` hit. The Monday newsletter reuses the same engine via internal
`/api/internal/recommended` (no metering).

Key files: `services/trip-service/utils/recommend.js`, `utils/embedding.js`,
`api/trips/recommended.get.js`, `packages/shared/embed.js`.

---

## 7. Cloud infrastructure (`TravelManagerIaC`)

- **GCP project** `project-3f93c20d-…`, region **`europe-west1`**.
- **GKE Autopilot** cluster `travelmanager-gke` (REGULAR channel, Workload Identity on by default, Google Managed Prometheus enabled).
- **Cloud SQL** Postgres 16, **Memorystore** Redis, **Pub/Sub**, **Artifact Registry** (`…/travelmanager`), **Secret Manager**.
- **External Secrets Operator** (v0.9.20) syncs Secret Manager → k8s Secrets hourly via `ClusterSecretStore` (Workload Identity — **no JSON keys**).
- **Terraform** in `terraform_gke/`: `gke.tf`, `sql.tf`, `iam.tf`, `pubsub.tf`, `redis.tf`, `secrets.tf`, `servicemesh.tf`, `monitoring.tf`, `firebase.tf`.
- **Vertex AI** (`aiplatform.googleapis.com`) for recommendation embeddings.

---

## 8. Istio / Cloud Service Mesh

Managed **Anthos / Cloud Service Mesh** (not self-hosted Istio):

- Cluster registered to a **Fleet**; mesh feature membership `MANAGEMENT_AUTOMATIC` (Google provisions + upgrades the control plane).
- Namespace `travelmanager` labeled `istio.io/rev: asm-managed` for sidecar injection.
- **mTLS STRICT** namespace-wide (`PeerAuthentication`), with **PERMISSIVE** exceptions on gateway + frontend pods so external LB health checks (plain HTTP) pass.
- **DestinationRule** for all in-mesh services: connection-pool caps (100 TCP / 100 HTTP2) + outlier detection (5×5xx → eject 30s).
- **Telemetry** 10% trace sampling → **Cloud Trace** (app already propagates trace headers via `packages/shared/trace.js`).
- **AuthorizationPolicy** per service (one ALLOW per backend keyed on mTLS KSA identity), gated by chart flag `global.perServiceServiceAccount`.
- Service ports named `http` + `appProtocol: http` so the mesh does L7 routing/retries.

---

## 9. Kubernetes / Helm

Single Helm chart `charts/travelmanager/` (~18 templates) renders everything:

- **Workloads**: `sync-services.yaml`, `worker-services.yaml` (Deployments + Services + HPA), `cronjobs.yaml` (7 jobs), `pgbouncer.yaml`, provisioner.
- **Networking / security**: `ingress.yaml`, `networkpolicy.yaml` (default-deny + allow-internal + allow-GCLB), `authorizationpolicy.yaml`, `serviceaccount.yaml`, `provisioner-rbac.yaml`.
- **Secrets**: `externalsecrets.yaml`, `provisioner-internal-token.yaml`, `tenant-db-credential.yaml`.
- **Observability**: `podmonitoring.yaml`.

Operational hardening:
- **HPA** on CPU 70%; edge services (gateway, frontend) **min 2 + PDB** to survive Autopilot node drains (a recurring 502 source if single-replica).
- **GKE Ingress** (`gce`) on a reserved static IP, pre-shared **wildcard TLS** cert, **BackendConfig** pinning health checks to real paths (`/healthz`, not `/`, since istio rewrites probes).
- **CronJob** pods carry `part-of: travelmanager` label (else NetworkPolicy drops their curl) + `holdApplicationUntilProxyStarts` and a `quitquitquit` sidecar shutdown.

---

## 10. Observability

- **Google Managed Prometheus** scrapes `PodMonitoring` targets at `/api/metrics` (30s). RED metrics: `http_requests_total`, `http_request_duration_seconds_bucket`, `usage_events_total`.
- **Cloud Trace** (mesh, 10% sampling) + **Cloud Logging** (structured stdout with trace IDs).
- **PromQL alert policies**: 5xx ratio > 5%, p99 latency > 1.5s, metering subscriber stalled, UsageRecorded DLQ backlog > 0.

---

## 11. Security

- **Firebase JWT** verified at the gateway; identity passed downstream as signed headers.
- **Workload Identity** everywhere — keyless GCP auth (runtime, ESO, Flux image-reflector).
- **NetworkPolicy default-deny**; only labeled TravelManager pods + GCLB allowed.
- **Secret Manager + ESO**; no secrets in git.
- **mTLS STRICT** east-west via the mesh.

---

## 12. Development journey

- Started as a monolith → refactored into microservices (see `docs/MILESTONE2_CHANGELOG.md`).
- Deploy-target evolution: **Cloud Run → IaaS/VM → GKE Autopilot** (load-test comparisons in `tests/load/`, Locust profiles).
- The mesh, per-service ServiceAccounts, and per-tenant provisioning were layered on as the platform matured.
- Cross-reference docs (not duplicated here): `docs/CLOUD_PROJECT_DOCUMENTATION.md`, `docs/SOFTWARE_ARCHITECTURE.md`, `docs/SERVICE_MESH.md`.

---

## 13. Architecture at a glance

```
                  *.onecloudaway.de  (DNS, static IP)
                            │
                     GKE Ingress (gce, wildcard TLS, BackendConfig)
                            │
              ┌─────────────┴──────────────┐
              ▼                             ▼
        api-gateway                     frontend (Nuxt SPA)
   (JWT, rate-limit, tenant            
    resolve, feature-gate)
              │  injects x-tenant-id / x-plan / x-role
   ┌──────────┼───────────────┬───────────────┬─────────────┐
   ▼          ▼               ▼               ▼             ▼
 user      trip          destination       social*      travel-info*   (+ notification*, metering*)
   │          │               │               │             │
   └──────────┴───────────────┴───────────────┴─────────────┘
          │                 │                    │
   Cloud SQL (7 DBs)    Firestore            Pub/Sub (5 topics + DLQ)  Redis
   + per-tenant            (comments/likes)      │
   Postgres pods                                 └─ workers (*) consume async

  All east-west traffic: mTLS via managed Cloud Service Mesh.
  Metrics → Managed Prometheus · Traces → Cloud Trace · Logs → Cloud Logging.
```
