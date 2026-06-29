// Enterprise tier provisioning: a dedicated GKE cluster + dedicated Cloud SQL per
// customer, built by a Terraform Kubernetes Job (NOT the in-cluster pod model in
// provision.js). The Job runs an immutable image that bundles `terraform_enterprise/`
// + the Helm chart and does one `terraform apply` (infra + helm in the same state).
// Cluster create takes 10-15 min — far longer than any HTTP request — so we fire the
// Job and return immediately; status is read live from the Job + a result ConfigMap
// the Job writes (keys: status, ingress_ip, system_hostname, cluster_name, error).
import k8s from '@kubernetes/client-node'

const NS = process.env.PROVISIONER_NAMESPACE || 'default'
// Immutable terraform+helm image (built in CI, tagged to the app imageTag).
const TF_IMAGE = process.env.ENTERPRISE_TF_IMAGE || ''
// KSA bound (Workload Identity) to a least-privilege GCP SA able to create clusters.
const TF_SA = process.env.ENTERPRISE_TF_SA || 'enterprise-provisioner'
// Secret carrying TF_VAR_* (db_password, API keys) — env, never command-line args.
const TF_SECRET = process.env.ENTERPRISE_TF_SECRET || 'enterprise-tf-secrets'
// A cold create stacks GKE Autopilot (create timeout 40m) + Cloud SQL (~15m) + Redis +
// ESO helm (15m) + 180s webhook wait + app helm wait (20m); even a fully healthy run is
// ~40-50 min, and the entrypoint may re-apply once on the cold-cluster ESO webhook race.
// 2400s (40m) was smaller than the healthy path, so the Job killed itself before helm
// finished. 90 min covers the healthy path plus one retry.
const DEADLINE = Number(process.env.ENTERPRISE_TF_DEADLINE_SECONDS || 5400)
// Keep finished Jobs around long enough for the admin console to read final status.
const TTL = Number(process.env.ENTERPRISE_TF_TTL_SECONDS || 3600)
// Short -lock-timeout: only ONE Job ever runs per tenant (deterministic name +
// backoffLimit 0 + the provisioner no-ops on an active Job), so any lock we hit is a
// stale leftover from a SIGKILLed run, not live contention. The entrypoint force-unlocks
// it, so a long wait would only delay that self-heal. 2m absorbs GCS eventual consistency.
const TF_LOCK_TIMEOUT = process.env.ENTERPRISE_TF_LOCK_TIMEOUT || '2m'
// Max time to wait for Kubernetes to remove an older lifecycle Job before retrying.
const JOB_DELETE_TIMEOUT_MS = Number(process.env.ENTERPRISE_JOB_DELETE_TIMEOUT_MS || 120000)
// GCS bucket holding terraform state (per-tenant prefix enterprise/<id>).
const TF_STATE_BUCKET = process.env.ENTERPRISE_TF_STATE_BUCKET || 'travelmanager-tfstate'
// App image tag the enterprise cluster should deploy (match the platform version).
const APP_IMAGE_TAG = process.env.ENTERPRISE_APP_IMAGE_TAG || process.env.TENANT_APP_IMAGE_TAG || 'latest'
// Cloud DNS managed zone hosting <tenant>.ent.onecloudaway.de (empty → module skips
// the A record; the system hostname won't resolve until DNS is wired manually).
const DNS_ZONE = process.env.ENTERPRISE_DNS_ZONE || ''
// Central Firebase project — the Job auto-adds the cluster's system hostname to its
// authorized domains so Google/email-link sign-in works without a manual console step.
const FIREBASE_PROJECT = process.env.ENTERPRISE_FIREBASE_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || ''

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/

// Enterprise provisioning needs a real cluster + the Batch API; gated on the same
// flag as the pod model so local dev (no cluster) short-circuits.
export function enterpriseEnabled() {
  return process.env.PROVISIONER_K8S_ENABLED === '1'
}

function clients() {
  const kc = new k8s.KubeConfig()
  kc.loadFromCluster() // in-cluster ServiceAccount
  return {
    batch: kc.makeApiClient(k8s.BatchV1Api),
    core: kc.makeApiClient(k8s.CoreV1Api),
  }
}

// action = 'apply' (create/converge) | 'destroy' (teardown)
function jobName(id, action) {
  return `ent-${action}-${id}`
}
function resultCmName(id) {
  return `ent-result-${id}`
}

function assertId(id) {
  if (!id || id === 'default' || !ID_RE.test(String(id))) {
    throw new Error(`valid tenantId required (got ${id ?? 'none'})`)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jobManifest(id, action) {
  const name = jobName(id, action)
  const l = {
    'app.kubernetes.io/part-of': 'travelmanager',
    'travelmanager.tenant': id,
    'travelmanager.enterprise-action': action,
  }
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name, labels: l },
    spec: {
      backoffLimit: 0, // never run two applies for one tenant concurrently
      activeDeadlineSeconds: DEADLINE,
      ttlSecondsAfterFinished: TTL,
      template: {
        metadata: {
          // part-of label required by the cluster NetworkPolicy; istio sidecar OFF —
          // a Job pod with an Istio sidecar never completes (the proxy stays up).
          labels: { 'app.kubernetes.io/part-of': 'travelmanager', 'travelmanager.tenant': id },
          annotations: { 'sidecar.istio.io/inject': 'false' },
        },
        spec: {
          serviceAccountName: TF_SA,
          restartPolicy: 'Never',
          containers: [
            {
              name: 'terraform',
              image: TF_IMAGE,
              // The image entrypoint runs: terraform init -reconfigure (GCS backend,
              // prefix enterprise/<tenant>) → apply/destroy -auto-approve → writes the
              // result ConfigMap. Secrets arrive as TF_VAR_* via envFrom (not on argv).
              env: [
                { name: 'TENANT_ID', value: id },
                { name: 'TF_ACTION', value: action },
                { name: 'RESULT_CONFIGMAP', value: resultCmName(id) },
                { name: 'RESULT_NAMESPACE', value: NS },
                { name: 'TF_STATE_BUCKET', value: TF_STATE_BUCKET },
                { name: 'TF_CLI_ARGS_apply', value: `-lock-timeout=${TF_LOCK_TIMEOUT}` },
                { name: 'TF_CLI_ARGS_destroy', value: `-lock-timeout=${TF_LOCK_TIMEOUT}` },
                { name: 'APP_IMAGE_TAG', value: APP_IMAGE_TAG },
                ...(DNS_ZONE ? [{ name: 'TF_VAR_dns_managed_zone', value: DNS_ZONE }] : []),
                ...(FIREBASE_PROJECT ? [{ name: 'FIREBASE_PROJECT_ID', value: FIREBASE_PROJECT }] : []),
              ],
              // TF_VAR_* (firebase_service_account, google_maps_server_key,
              // resend_api_key, admin_email, dns_managed_zone) come from this Secret.
              envFrom: [{ secretRef: { name: TF_SECRET, optional: true } }],
            },
          ],
        },
      },
    },
  }
}

async function waitForJobDeleted(batch, name) {
  const started = Date.now()
  while (Date.now() - started < JOB_DELETE_TIMEOUT_MS) {
    try {
      await batch.readNamespacedJob(name, NS)
    } catch (e) {
      const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
      if (code === 404) return
      throw e
    }
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for Kubernetes Job ${name} to be deleted`)
}

// 'active'   — a Terraform process is mid apply/destroy (holds the GCS state lock)
// 'finished' — pod has exited (succeeded or failed); no lock held
// 'absent'   — no such Job
async function jobState(batch, name) {
  try {
    const s = (await batch.readNamespacedJob(name, NS))?.body?.status || {}
    return s.succeeded || s.failed ? 'finished' : 'active'
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code === 404) return 'absent'
    throw e
  }
}

// Reap a FINISHED Job so its deterministic name is free to recreate. Its pod has already
// exited, so there is no Terraform process to kill and no state lock to orphan —
// Background propagation is safe and returns fast (no waiting on a live pod to drain).
async function reapFinishedJob(batch, name) {
  try {
    await batch.deleteNamespacedJob(name, NS, undefined, undefined, undefined, undefined, 'Background')
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code === 404) return
    throw e
  }
  await waitForJobDeleted(batch, name) // name must be gone before recreating
}

// Make the deterministic apply/destroy Job names free for a fresh run WITHOUT ever
// killing a running Terraform pod. A FINISHED prior Job is reaped; an ACTIVE one is left
// alone and reported via `busy` — SIGKILLing a mid-apply pod orphans the GCS state lock
// (no TTL), and the next run then blocks the full -lock-timeout (20m) before failing. The
// in-flight run is idempotent and the SPA keeps polling it, so a no-op is the safe answer.
async function prepareLifecycle(batch, core, id) {
  for (const action of ['apply', 'destroy']) {
    const name = jobName(id, action)
    const state = await jobState(batch, name)
    if (state === 'active') return { busy: action }
    if (state === 'finished') await reapFinishedJob(batch, name)
  }
  await deleteResultIfExists(core, id)
  return { busy: null }
}

async function deleteResultIfExists(core, id) {
  try {
    await core.deleteNamespacedConfigMap(resultCmName(id), NS)
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code !== 404) throw e
  }
}

// Read the result ConfigMap the Job writes on completion. Returns null if absent.
async function readResult(core, id) {
  try {
    const res = await core.readNamespacedConfigMap(resultCmName(id), NS)
    const d = res?.body?.data || {}
    return {
      status: d.status || '',
      ingress_ip: d.ingress_ip || null,
      system_hostname: d.system_hostname || null,
      cluster_name: d.cluster_name || null,
      error: d.error || null,
    }
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code === 404) return null
    throw e
  }
}

// Spawn the enterprise apply Job (create/converge the dedicated cluster). Returns
// fast — the caller polls enterpriseStatus(). Re-running is safe: a prior FINISHED
// lifecycle Job is reaped first and `terraform apply` itself is idempotent (resume =
// re-run). If a lifecycle Job is still ACTIVE we leave it running and no-op (returning
// alreadyRunning) rather than kill it — see prepareLifecycle. A stale result ConfigMap
// is cleared so status reflects this run.
export async function applyEnterprise(id) {
  assertId(id)
  if (!enterpriseEnabled()) return { skipped: 'k8s disabled', job: jobName(id, 'apply') }
  if (!TF_IMAGE) throw new Error('ENTERPRISE_TF_IMAGE not set')
  const { batch, core } = clients()
  const name = jobName(id, 'apply')
  const { busy } = await prepareLifecycle(batch, core, id)
  if (busy) return { job: jobName(id, busy), alreadyRunning: busy }
  await batch.createNamespacedJob(NS, jobManifest(id, 'apply'))
  return { job: name }
}

// Spawn the enterprise destroy Job (terraform destroy). The image clears Cloud SQL
// deletion-protection, releases the static IP and cleans the state prefix.
export async function destroyEnterprise(id) {
  assertId(id)
  if (!enterpriseEnabled()) return { skipped: 'k8s disabled', job: jobName(id, 'destroy') }
  if (!TF_IMAGE) throw new Error('ENTERPRISE_TF_IMAGE not set')
  const { batch, core } = clients()
  const name = jobName(id, 'destroy')
  const { busy } = await prepareLifecycle(batch, core, id)
  // A destroy already running → no-op. An apply still running → leave it (killing it
  // orphans the lock); the operator can retry the teardown once the apply settles.
  if (busy) return { job: jobName(id, busy), alreadyRunning: busy }
  await batch.createNamespacedJob(NS, jobManifest(id, 'destroy'))
  return { job: name }
}

// Live status of an enterprise apply/destroy Job. phase: pending|running|live|failed|
// unknown. Status derives from the Job (source of truth) + the result ConfigMap
// (Terraform outputs / error message). Survives Job GC via the ConfigMap.
export async function enterpriseStatus(id, action = 'apply') {
  assertId(id)
  if (!enterpriseEnabled()) {
    return { phase: 'live', ingress_ip: null, system_hostname: null, cluster_name: null, error: null }
  }
  const { batch, core } = clients()
  const name = jobName(id, action)
  const result = await readResult(core, id)
  const outputs = {
    ingress_ip: result?.ingress_ip || null,
    system_hostname: result?.system_hostname || null,
    cluster_name: result?.cluster_name || null,
  }

  let job = null
  try {
    job = (await batch.readNamespacedJob(name, NS))?.body
  } catch (e) {
    const code = e?.statusCode || e?.response?.statusCode || e?.body?.code
    if (code !== 404) throw e
  }

  // Job GC'd (or never seen) — fall back to the persisted result.
  if (!job) {
    if (result?.status === 'ok') return { phase: 'live', ...outputs, error: null }
    if (result?.status === 'error') return { phase: 'failed', ...outputs, error: result.error || 'terraform failed' }
    // A teardown writes no success ConfigMap (it has no outputs to persist) and its
    // Job is GC'd after ttlSecondsAfterFinished. For a destroy, an absent Job with no
    // recorded error means the resources are gone — report it complete so the tenant
    // row can be finalized instead of stranding on 'unknown' forever. (apply must stay
    // 'unknown' here: a create is never marked live without an explicit success signal.)
    if (action === 'destroy') return { phase: 'live', ...outputs, error: null }
    return { phase: 'unknown', ...outputs, error: null }
  }

  const s = job.status || {}
  if (s.succeeded) return { phase: 'live', ...outputs, error: null }
  if (s.failed) return { phase: 'failed', ...outputs, error: result?.error || 'terraform job failed' }
  return { phase: 'running', ...outputs, error: null }
}
