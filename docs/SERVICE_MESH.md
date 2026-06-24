# Service Mesh — Cloud Service Mesh (managed Istio)

East-west security + resilience + observability for the TravelManager
microservices. The mesh runtime lives in **TravelManagerIaC** (Terraform + Flux);
this repo carries only the app-readiness changes. Pairs with the metrics/GMP work
in `docs/METERING_AND_MONITORING.md`.

Cluster = **GKE Autopilot** → self-managed sidecars are restricted, so the mesh is
**Cloud Service Mesh (CSM)**, Google's managed Istio, with auto-injected
`istio-proxy` sidecars.

---

## 1. What shipped in this repo (app readiness)

The sidecar adds mTLS, retries, and per-hop telemetry **transparently** — `$fetch`
URLs are unchanged. The only thing the app must do is **propagate trace context**,
plus make the dynamically-generated tenant pods mesh-friendly.

- `packages/shared/trace.js` — `traceHeaders(event)` returns the inbound trace
  headers (B3 `x-b3-*`, W3C `traceparent`/`tracestate`, Envoy `x-request-id`, GCP
  `x-cloud-trace-context`, `baggage`) to spread into an outbound `$fetch`. Returns
  `{}` for background/cron callers (no inbound trace). Exported via
  `@travelmanager/shared/trace`.
- **7 request-path `$fetch` sites** now spread `...traceHeaders(event)`:
  `social-service/api/feed.get.js`, `travel-info-service/api/weather.get.js`,
  `destination-service/api/b2b/destinations/[id]/travelers.get.js`,
  `trip-service/api/travel-plans/[tripId].get.js`,
  `user-service/api/tenants/self-serve.post.js`,
  `user-service/api/admin/tenants/index.post.js`, `…/[id].delete.js`.
  Background callers (poller, newsletter, `listTenantIds`) intentionally start a
  fresh trace and are left alone.
- `api-gateway/utils/proxy.js` already forwards all non-hop-by-hop inbound headers
  → client trace headers reach the first service unchanged. No edit needed.
- `provisioner-service/utils/k8s.js` — per-tenant manifests made mesh-ready:
  - app `Service` port named `http` + `appProtocol: http` (Istio L7 detection),
  - app pod annotation `proxy.istio.io/config: holdApplicationUntilProxyStarts=true`,
  - tenant `Postgres` pod annotated `sidecar.istio.io/inject: "false"` (stays out of
    the mesh; already NetworkPolicy-isolated, plain-TCP DB).
  All inert until CSM injection is enabled on the namespace.
- Tests: `tests/unit/trace.test.js` (5). Full suite **157 passing**; all 6 edited
  services `nitro build` clean.

---

## 2. TODO in TravelManagerIaC (mesh runtime)

### 2a. Enable CSM (managed)
- Register the cluster to a **fleet** and enable the managed `servicemesh` feature
  (Terraform `google_gke_hub_feature` + `…_feature_membership` with management
  `MANAGEMENT_AUTOMATIC`), or `gcloud container fleet mesh enable` + update membership.
- Label the workload namespace for **managed injection**:
  `kubectl label namespace <ns> istio.io/rev=<managed-revision> istio-injection-`
  (managed rev comes from `kubectl get controlplanerevision -n istio-system`).
- Roll the existing Deployments so they pick up sidecars (`kubectl rollout restart`).
  Expect app pods to become `2/2`; tenant Postgres pods stay `1/1`.

### 2b. mTLS
```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata: { name: default, namespace: <ns> }
spec: { mtls: { mode: STRICT } }
```
> The GKE Ingress → gateway hop: the external LB health check is plain HTTP. Istio
> rewrites kubelet probes automatically, but if LB checks fail under STRICT, scope a
> `PeerAuthentication` with `mode: PERMISSIVE` on the **gateway** workload only, or
> use a healthcheck path exception. Keep STRICT everywhere east-west.

### 2c. Authorization (identity-based, layered on the existing NetworkPolicies)
`AuthorizationPolicy` per workload, keyed on the caller's SA (all pods run as
`travelmanager` today — split SAs per service first if you want least-privilege
edges). Known east-west edges to allow: gateway→all app services;
social→trip, travel-info→trip, destination→trip, *→user, user→provisioner.
Default-deny once the allow-list is complete.

### 2d. Resilience
`DestinationRule` per service host (incl. per-tenant `<svc>-<tenant>` hosts via a
wildcard or generated rules):
```yaml
spec:
  trafficPolicy:
    connectionPool: { tcp: { maxConnections: 100 }, http: { http2MaxRequests: 100 } }
    outlierDetection: { consecutive5xxErrors: 5, interval: 30s, baseEjectionTime: 30s }
```
Retries: set on a `VirtualService` (e.g. `attempts: 2, retryOn: 5xx,connect-failure`)
— note the app already `.catch()`es inter-service failures, so mesh retries are
additive, not a behavior change.

### 2e. Telemetry → Cloud Trace + GMP
```yaml
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata: { name: mesh-default, namespace: istio-system }
spec:
  tracing: [{ randomSamplingPercentage: 10 }]   # → Cloud Trace
```
- Distributed traces stitch automatically now that the app propagates headers (§1).
- Add a `PodMonitoring` scraping the sidecar's merged Prometheus endpoint
  (`:15020/stats/prometheus`) so `istio_requests_total` / `istio_request_duration`
  feed the Grafana RED dashboards from `METERING_AND_MONITORING.md` (mesh golden
  signals alongside the app `http_*` metrics).

### 2f. Ports & probes
App Services expose `http`-named ports (shared chart + tenant pods done). Istio
auto-rewrites the existing `/api/health` (liveness) + `/api/ready` (readiness)
httpGet probes — no probe change.

---

## 3. Verification
1. `npx vitest run tests/unit/trace.test.js` — propagation helper.
2. Local (no mesh): send `traceparent: 00-<trace>-<span>-01` to the gateway for a
   feed request; confirm trip-service receives the SAME trace id (temp log) → header
   survives gateway→social→trip.
3. In-cluster (post-CSM): Cloud Trace shows ONE trace spanning gateway→social→trip;
   `kubectl get pods` → app `2/2`, postgres `1/1`; `istioctl analyze -n <ns>` clean;
   Grafana shows `istio_requests_total`.

## Out of scope
App→Postgres mTLS (plain TCP), Istio ingress gateway replacing GKE Ingress
(north-south unchanged), multi-cluster, Pub/Sub (async path isn't mesh traffic).
