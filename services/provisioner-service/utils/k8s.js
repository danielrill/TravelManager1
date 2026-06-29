// Kubernetes provisioning of a per-tenant Postgres pod. Creates a StatefulSet +
// headless Service + PVC (+ NetworkPolicy) named postgres-<id>. Idempotent: an
// already-existing object (409) is treated as success so provisioning is safe to
// retry. Disabled (PROVISIONER_K8S_ENABLED!=1) for local dev where there is no
// cluster — callers then assume the DB host already exists.
import k8s from '@kubernetes/client-node'

const SCHEMA_NS = process.env.PROVISIONER_NAMESPACE || 'default'
// pgvector image so per-tenant trip embeddings (recommendations) work; the trip
// schema's CREATE EXTENSION vector self-disables if it's ever absent.
const PG_IMAGE = process.env.TENANT_PG_IMAGE || 'pgvector/pgvector:pg16'
const PG_STORAGE = process.env.TENANT_PG_STORAGE || '5Gi'
const STORAGE_CLASS = process.env.TENANT_PG_STORAGE_CLASS || undefined

export function k8sEnabled() {
  return process.env.PROVISIONER_K8S_ENABLED === '1'
}

function clients() {
  const kc = new k8s.KubeConfig()
  kc.loadFromCluster() // in-cluster ServiceAccount
  return {
    apps: kc.makeApiClient(k8s.AppsV1Api),
    core: kc.makeApiClient(k8s.CoreV1Api),
    net: kc.makeApiClient(k8s.NetworkingV1Api),
    autoscaling: kc.makeApiClient(k8s.AutoscalingV2Api),
    custom: kc.makeApiClient(k8s.CustomObjectsApi), // GKE svcneg CRD (NEG capacity preflight)
  }
}

// Treat 409 (AlreadyExists) as success so the whole flow is idempotent.
async function ignoreConflict(p) {
  try {
    return await p
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code === 409) return null
    throw e
  }
}

// Treat 404 (NotFound) as success so teardown is idempotent / safe to re-run.
async function ignoreMissing(p) {
  try {
    return await p
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code === 404) return null
    throw e
  }
}

// Labels every tenant Postgres workload must carry. part-of=travelmanager is
// REQUIRED — the cluster NetworkPolicy drops traffic from pods without it.
function labels(id) {
  return {
    app: `postgres-${id}`,
    'app.kubernetes.io/part-of': 'travelmanager',
    'travelmanager.tenant': id,
  }
}

function statefulSet(id, secretName) {
  const name = `postgres-${id}`
  const l = labels(id)
  return {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: { name, labels: l },
    spec: {
      serviceName: name,
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: {
          labels: l,
          // Keep the tenant Postgres pod OUT of the service mesh: it's already
          // L3/L4-isolated by the NetworkPolicy below, and a plain-TCP DB
          // connection avoids mTLS interplay with the pg_isready readiness probe.
          // (App→Postgres stays L4-isolated, not mTLS, in v1.)
          annotations: { 'sidecar.istio.io/inject': 'false' },
        },
        spec: {
          containers: [
            {
              name: 'postgres',
              image: PG_IMAGE,
              ports: [{ containerPort: 5432 }],
              env: [
                { name: 'POSTGRES_USER', valueFrom: { secretKeyRef: { name: secretName, key: 'username' } } },
                { name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name: secretName, key: 'password' } } },
                { name: 'POSTGRES_DB', value: 'postgres' },
                { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' },
              ],
              volumeMounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' }],
              readinessProbe: {
                exec: { command: ['sh', '-c', 'pg_isready -U "$POSTGRES_USER"'] },
                initialDelaySeconds: 5,
                periodSeconds: 5,
              },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: 'data' },
          spec: {
            accessModes: ['ReadWriteOnce'],
            ...(STORAGE_CLASS ? { storageClassName: STORAGE_CLASS } : {}),
            resources: { requests: { storage: PG_STORAGE } },
          },
        },
      ],
    },
  }
}

function service(id) {
  const name = `postgres-${id}`
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, labels: labels(id) },
    spec: {
      selector: { app: name },
      ports: [{ port: 5432, targetPort: 5432 }],
      clusterIP: 'None', // headless: stable DNS postgres-<id>
    },
  }
}

// Allow ingress to the tenant DB only from TravelManager pods.
function networkPolicy(id) {
  const name = `postgres-${id}`
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name, labels: labels(id) },
    spec: {
      podSelector: { matchLabels: { app: name } },
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: { 'app.kubernetes.io/part-of': 'travelmanager' } } }],
          ports: [{ protocol: 'TCP', port: 5432 }],
        },
      ],
    },
  }
}

// Create the StatefulSet + Service (+ NetworkPolicy) for a tenant. The DB
// credential Secret is expected to already exist (shared cluster credential
// mounted in all services); its name comes from TENANT_DB_SECRET.
export async function createTenantPostgres(id) {
  if (!k8sEnabled()) return { skipped: 'k8s disabled' }
  const { apps, core, net } = clients()
  const secretName = process.env.TENANT_DB_SECRET || 'tenant-db-credential'

  await ignoreConflict(core.createNamespacedService(SCHEMA_NS, service(id)))
  await ignoreConflict(net.createNamespacedNetworkPolicy(SCHEMA_NS, networkPolicy(id)))
  await ignoreConflict(apps.createNamespacedStatefulSet(SCHEMA_NS, statefulSet(id, secretName)))
  return { created: `postgres-${id}` }
}

// Poll until the StatefulSet reports a ready replica (or timeout). Mirrors the
// schema-bootstrap backoff philosophy: tolerate cold-start latency.
export async function waitForTenantPostgres(id, { timeoutMs = 180000, intervalMs = 4000 } = {}) {
  if (!k8sEnabled()) return true
  const { apps } = clients()
  const name = `postgres-${id}`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await apps.readNamespacedStatefulSetStatus(name, SCHEMA_NS)
      const ready = res?.body?.status?.readyReplicas || 0
      if (ready >= 1) return true
    } catch (e) {
      console.error(`[provisioner] waitForReady ${name}:`, e?.message || e)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`tenant postgres ${name} not ready within ${timeoutMs}ms`)
}

// ─── Per-tenant application pods ─────────────────────────────────────────────
// A standard tenant gets its OWN Deployment + Service + HPA for every backend
// service (compute isolation), named <svc>-<id>, on the same cluster. Each
// scales 1→2. The gateway routes that tenant's traffic to these pods; the pods
// form a closed mesh (their *_SERVICE_URL point at each other), and pick the
// tenant's Postgres pod per request via the x-tenant-id header (tenant-db.js).
const APP_SERVICES = [
  'user-service',
  'trip-service',
  'destination-service',
  'social-service',
  'travel-info-service',
  'notification-service',
]

// Which services get a DEDICATED per-tenant pod. MUST match the api-gateway's
// TENANT_DEDICATED_SERVICES (same env, same default) — the gateway routes a
// tenant's traffic to <svc>-<tenant> ONLY for these, so anything dedicated here
// but not there (or vice-versa) makes that tenant 503. Everything else uses the
// shared pod (tenant-correct via x-tenant-id header routing in tenant-db.js).
// Default: the two DB-isolated services (trip, social) — they keep their own
// compute; the other 4 are shared-DB and gain nothing from a dedicated pod.
export function dedicatedServices() {
  const set = new Set(
    (process.env.TENANT_DEDICATED_SERVICES || 'trip-service,social-service')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  // Only ever dedicate services we actually know how to deploy.
  return APP_SERVICES.filter((s) => set.has(s))
}

export function dedicatedPodsEnabled() {
  return process.env.TENANT_DEDICATED_PODS === '1'
}

// ServiceAccount for a per-tenant app pod. Default: the single shared KSA
// `travelmanager` (one Workload-Identity binding, current behaviour). With
// TENANT_PER_SERVICE_SA=1 each service gets its OWN KSA (`<svc minus -service>-sa`,
// e.g. trip-service → trip-sa) so a future Istio AuthorizationPolicy can key
// east-west edges on the caller's mTLS identity (the KSA) instead of treating
// every pod as the same principal. The KSAs + their WI bindings are created in
// TravelManagerIaC FIRST — flip the flag only once they exist, else the pod
// references a missing SA and stays Pending. Override the mapping per service
// via TENANT_SERVICE_SA_MAP="trip-service=trip-sa,social-service=social-sa".
export function serviceAccountFor(svc) {
  if (process.env.TENANT_PER_SERVICE_SA !== '1') return 'travelmanager'
  const override = Object.fromEntries(
    (process.env.TENANT_SERVICE_SA_MAP || '')
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()))
      .filter(([sv, sa]) => sv && sa)
  )
  return override[svc] || `${svc.replace(/-service$/, '')}-sa`
}

const APP_IMAGE_REGISTRY = process.env.TENANT_APP_IMAGE_REGISTRY || ''
const APP_IMAGE_TAG = process.env.TENANT_APP_IMAGE_TAG || 'latest'
const APP_HPA_MIN = Number(process.env.TENANT_APP_HPA_MIN || 1)
const APP_HPA_MAX = Number(process.env.TENANT_APP_HPA_MAX || 2)
const APP_PULL_POLICY = process.env.TENANT_APP_IMAGE_PULL_POLICY || 'Always'

// Plain common-env keys carried by the provisioner (from tm.commonEnv) that every
// per-tenant app pod also needs. Service-to-service URLs are deliberately excluded
// — they're rewritten per tenant below. DB creds + API keys arrive via envFrom the
// per-service Secret, so they're not listed here.
const COPIED_ENV = [
  'NODE_ENV', 'GOOGLE_CLOUD_PROJECT', 'VERTEX_LOCATION', 'FROM_EMAIL', 'APP_BASE_URL',
  'ROOT_DOMAIN', 'ADMIN_EMAILS', 'PROVISIONER_K8S_ENABLED', 'PROVISIONER_NAMESPACE',
  'TENANT_DB_SECRET', 'TENANT_DB_HOST_SUFFIX', 'TENANT_DB_PORT', 'TENANT_DB_USER',
  'TENANT_DB_PASSWORD', 'TENANT_DEDICATED_PODS', 'TENANT_APP_IMAGE_REGISTRY',
  'TENANT_APP_IMAGE_TAG', 'TENANT_APP_HPA_MIN', 'TENANT_APP_HPA_MAX',
]

// envVar → k8s service name, for the service-to-service URL block below.
const SERVICE_URL_ENV = [
  ['USER_SERVICE_URL', 'user-service'],
  ['TRIP_SERVICE_URL', 'trip-service'],
  ['DESTINATION_SERVICE_URL', 'destination-service'],
  ['SOCIAL_SERVICE_URL', 'social-service'],
  ['TRAVEL_INFO_SERVICE_URL', 'travel-info-service'],
]

export function appEnv(id) {
  const env = [
    { name: 'NITRO_HOST', value: '0.0.0.0' },
    { name: 'NITRO_PORT', value: '8080' },
  ]
  for (const k of COPIED_ENV) {
    if (process.env[k] != null) env.push({ name: k, value: String(process.env[k]) })
  }
  // Service-to-service URLs. A DEDICATED service is reached at its tenant-suffixed
  // pod (<svc>-<id>); a SHARED one points at the shared Service (the provisioner's
  // own *_SERVICE_URL env, or the in-cluster name as a fallback). This matters: if a
  // dedicated trip pod kept the old all-suffixed mesh it would call <svc>-<id> pods
  // that no longer exist for the shared services and 503.
  const dedicated = new Set(dedicatedServices())
  for (const [envKey, svc] of SERVICE_URL_ENV) {
    const value = dedicated.has(svc)
      ? `http://${svc}-${id}:8080`
      : process.env[envKey] || `http://${svc}:8080`
    env.push({ name: envKey, value })
  }
  // Provisioning stays a shared control-plane concern.
  env.push({ name: 'PROVISIONER_SERVICE_URL', value: 'http://provisioner-service:8080' })
  return env
}

function appLabels(id, svc) {
  const name = `${svc}-${id}`
  return { ...labels(id), app: name, 'travelmanager.service': svc }
}

function appDeployment(id, svc) {
  const name = `${svc}-${id}`
  const l = appLabels(id, svc)
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, labels: l },
    spec: {
      // No replicas — the HPA owns .spec.replicas (mirrors the shared Deployments).
      selector: { matchLabels: { app: name } },
      template: {
        metadata: {
          labels: l,
          // Service-mesh (Cloud Service Mesh / Istio): hold the app's outbound
          // traffic until the istio-proxy sidecar is ready, so a cold-started
          // tenant pod doesn't emit requests that fail mTLS before the proxy is up.
          // Inert until CSM injection is enabled on the namespace (TravelManagerIaC);
          // sidecar injection itself is namespace-labeled, so these pods join the
          // mesh automatically once that's on.
          annotations: {
            'proxy.istio.io/config': '{"holdApplicationUntilProxyStarts":true}',
          },
        },
        spec: {
          serviceAccountName: serviceAccountFor(svc),
          containers: [
            {
              name: svc,
              image: `${APP_IMAGE_REGISTRY}/${svc}:${APP_IMAGE_TAG}`,
              imagePullPolicy: APP_PULL_POLICY,
              ports: [{ containerPort: 8080 }],
              env: appEnv(id),
              envFrom: [{ secretRef: { name: `${svc}-secrets`, optional: true } }],
              readinessProbe: {
                httpGet: { path: '/api/ready', port: 8080 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: { path: '/api/health', port: 8080 },
                initialDelaySeconds: 15,
                periodSeconds: 20,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              resources: {
                requests: { cpu: '100m', memory: '192Mi' },
                limits: { cpu: '1000m', memory: '512Mi' },
              },
            },
          ],
        },
      },
    },
  }
}

function appService(id, svc) {
  const name = `${svc}-${id}`
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, labels: appLabels(id, svc) },
    // Port named `http` (+ appProtocol) so Istio detects the L7 protocol and the
    // mesh can do HTTP-aware routing/retries/telemetry for tenant pods.
    spec: { selector: { app: name }, ports: [{ name: 'http', port: 8080, targetPort: 8080, appProtocol: 'http' }] },
  }
}

function appHpa(id, svc) {
  const name = `${svc}-${id}`
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { name, labels: appLabels(id, svc) },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name },
      minReplicas: APP_HPA_MIN,
      maxReplicas: APP_HPA_MAX,
      metrics: [
        { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } },
      ],
    },
  }
}

function meshHost(id, svc) {
  return `${svc}-${id}.${SCHEMA_NS}.svc.cluster.local`
}

function meshServiceEntry(id, svc) {
  const name = `${svc}-${id}`
  return {
    apiVersion: 'networking.istio.io/v1beta1',
    kind: 'ServiceEntry',
    metadata: { name, labels: appLabels(id, svc) },
    spec: {
      hosts: [meshHost(id, svc), name],
      location: 'MESH_INTERNAL',
      ports: [{ number: 8080, name: 'http', protocol: 'HTTP' }],
      resolution: 'DNS',
    },
  }
}

function meshDestinationRule(id, svc) {
  const name = `${svc}-${id}`
  return {
    apiVersion: 'networking.istio.io/v1beta1',
    kind: 'DestinationRule',
    metadata: { name, labels: appLabels(id, svc) },
    spec: {
      host: meshHost(id, svc),
      trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } },
    },
  }
}

async function createMeshRoute(custom, id, svc) {
  await ignoreConflict(custom.createNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', SCHEMA_NS, 'serviceentries', meshServiceEntry(id, svc)
  ))
  await ignoreConflict(custom.createNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', SCHEMA_NS, 'destinationrules', meshDestinationRule(id, svc)
  ))
}

async function deleteMeshRoute(custom, id, svc) {
  const name = `${svc}-${id}`
  await ignoreMissing(custom.deleteNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', SCHEMA_NS, 'destinationrules', name
  ))
  await ignoreMissing(custom.deleteNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', SCHEMA_NS, 'serviceentries', name
  ))
}

// Create the per-tenant Deployment + Service + HPA for every backend service.
// Idempotent (409 → success).
export async function createTenantApps(id) {
  if (!k8sEnabled()) return { skipped: 'k8s disabled' }
  if (!dedicatedPodsEnabled()) return { skipped: 'dedicated tenant pods disabled' }
  if (!APP_IMAGE_REGISTRY) throw new Error('TENANT_APP_IMAGE_REGISTRY not set')
  const { apps, core, autoscaling, custom } = clients()
  const created = []
  // Only the DEDICATED services get a per-tenant pod; the rest run on shared pods.
  for (const svc of dedicatedServices()) {
    await ignoreConflict(core.createNamespacedService(SCHEMA_NS, appService(id, svc)))
    await createMeshRoute(custom, id, svc)
    await ignoreConflict(apps.createNamespacedDeployment(SCHEMA_NS, appDeployment(id, svc)))
    await ignoreConflict(autoscaling.createNamespacedHorizontalPodAutoscaler(SCHEMA_NS, appHpa(id, svc)))
    created.push(`${svc}-${id}`)
  }
  return { created }
}

// HTTP readiness gate via the tenant pod's Service name. A Deployment showing
// availableReplicas>=1 only means the pod passed its readiness probe LOCALLY —
// the Service endpoint + managed-ASM mesh NEG that the gateway actually routes
// through propagate a few seconds later. Marking the tenant live on the pod-ready
// signal alone leaves a window where the gateway gets 0 healthy upstreams and
// every /api/* 503s on a tenant that already looks provisioned. So after the
// replica is available we additionally require a 200 from /api/ready THROUGH the
// Service name — the exact path the gateway takes — before treating the app as
// serving. Returns true on 200, false otherwise (caller keeps polling).
async function serviceReady(name) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 3000)
  try {
    const res = await fetch(`http://${name}:8080/api/ready`, { signal: ctl.signal })
    return res.ok
  } catch {
    return false // endpoint/mesh not routable yet — keep waiting
  } finally {
    clearTimeout(t)
  }
}

// Poll until every per-tenant app Deployment has ≥1 available replica AND answers
// 200 on /api/ready through its Service (endpoints + mesh routable), so the gateway
// never routes to a tenant pod that isn't serving yet.
export async function waitForTenantApps(id, { timeoutMs = Number(process.env.TENANT_APP_READY_TIMEOUT_MS || 600000), intervalMs = 4000 } = {}) {
  if (!k8sEnabled()) return true
  if (!dedicatedPodsEnabled()) return true
  const { apps } = clients()
  const deadline = Date.now() + timeoutMs
  const pending = new Set(dedicatedServices().map((s) => `${s}-${id}`))
  while (Date.now() < deadline && pending.size) {
    for (const name of [...pending]) {
      try {
        const res = await apps.readNamespacedDeploymentStatus(name, SCHEMA_NS)
        if ((res?.body?.status?.availableReplicas || 0) >= 1 && (await serviceReady(name))) {
          pending.delete(name)
        }
      } catch (e) {
        console.error(`[provisioner] waitForApps ${name}:`, e?.message || e)
      }
    }
    if (pending.size) await new Promise((r) => setTimeout(r, intervalMs))
  }
  if (pending.size) throw new Error(`tenant app pods not ready: ${[...pending].join(', ')}`)
  return true
}

// Count GKE ServiceNetworkEndpointGroup (svcneg) CRs in the app namespace — one per
// NEG-backed Service. Each maps to ~NEG_ZONE_COUNT zonal NEGs against the regional
// GCP NETWORK_ENDPOINT_GROUPS quota. Used by the provisioning capacity preflight.
// Scoped to SCHEMA_NS (not cluster-wide): every tenant's NEG-backed Services live in
// this namespace, so a namespaced list is accurate AND keeps the provisioner's RBAC
// free of any cluster-scoped grant (a cluster list 403s under the namespaced Role).
export async function countServiceNegs() {
  if (!k8sEnabled()) return 0
  const { custom } = clients()
  const res = await custom.listNamespacedCustomObject(
    'networking.gke.io', 'v1beta1', SCHEMA_NS, 'servicenetworkendpointgroups'
  )
  const items = res?.body?.items ?? res?.items ?? []
  return items.length
}

// How many NEG-backed Services a new tenant adds: one per dedicated app service
// + the (headless) Postgres Service.
export function tenantNegCount() {
  return (dedicatedPodsEnabled() ? dedicatedServices().length : 0) + 1
}

// Tear down a tenant's app pods (Deployment + Service + HPA per service).
// Best-effort; ignores 404 so it's safe to re-run.
export async function deleteTenantApps(id) {
  if (!k8sEnabled()) return { skipped: 'k8s disabled' }
  const { apps, core, autoscaling, custom } = clients()
  const deleted = []
  for (const svc of APP_SERVICES) {
    const name = `${svc}-${id}`
    await ignoreMissing(autoscaling.deleteNamespacedHorizontalPodAutoscaler(name, SCHEMA_NS))
    await ignoreMissing(apps.deleteNamespacedDeployment(name, SCHEMA_NS))
    await ignoreMissing(core.deleteNamespacedService(name, SCHEMA_NS))
    await deleteMeshRoute(custom, id, svc)
    deleted.push(name)
  }
  return { deleted }
}

// Delete a tenant's Postgres (offboarding): StatefulSet, Service, NetworkPolicy
// AND the PVC (StatefulSets do NOT garbage-collect their PVCs, so the data volume
// would otherwise linger and cost storage / clash on re-create). Best-effort;
// ignores 404 so it's safe to re-run.
export async function deleteTenantPostgres(id) {
  if (!k8sEnabled()) return { skipped: 'k8s disabled' }
  const { apps, core, net } = clients()
  const name = `postgres-${id}`
  // StatefulSet volumeClaimTemplate 'data' + the single replica -0 → this PVC name.
  const pvc = `data-${name}-0`
  const ignore404 = async (p) => { try { await p } catch (e) { const c = e?.statusCode || e?.body?.code; if (c !== 404) throw e } }
  await ignore404(apps.deleteNamespacedStatefulSet(name, SCHEMA_NS))
  await ignore404(net.deleteNamespacedNetworkPolicy(name, SCHEMA_NS))
  await ignore404(core.deleteNamespacedService(name, SCHEMA_NS))
  await ignore404(core.deleteNamespacedPersistentVolumeClaim(pvc, SCHEMA_NS))
  return { deleted: name, pvc }
}
