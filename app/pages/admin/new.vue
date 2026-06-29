<!-- Create + provision a tenant.
     • Standard: POST /api/admin/tenants registers the tenant and detaches the
       provisioner (dedicated Postgres pod + app pods); the page polls until the
       subdomain comes live, then shows the access code to hand to the customer.
     • Enterprise: provisions a DEDICATED GKE cluster + Cloud SQL via a Terraform
       Job (10–15 min). There is no subdomain — the customer points their OWN domain
       at the cluster's ingress IP, which we surface once the apply completes. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <h2>New Tenant</h2>
      <NuxtLink to="/admin" class="btn-secondary">← Back</NuxtLink>
    </div>

    <!-- Success card -->
    <div v-if="created" class="created-card">
      <!-- ── Enterprise ── -->
      <template v-if="created.plan === 'enterprise'">
        <p v-if="provisioning" class="code-pending">⏳ Building a dedicated cluster for “{{ created.id }}” — this can take 10–15 minutes…</p>
        <p v-else-if="failed" class="code-pending">✗ Provisioning failed: {{ error }}</p>
        <p v-else-if="slow" class="code-pending">⏳ Still provisioning “{{ created.id }}”. This is taking longer than usual; it will come live shortly.</p>
        <p v-else class="code-ok">✓ Dedicated cluster for “{{ created.id }}” is live.</p>

        <template v-if="result?.status === 'live'">
          <p class="muted">The customer points their own domain (A record) at this ingress IP:</p>
          <div class="code-row">
            <code class="code-value">{{ result.ingress_ip || '—' }}</code>
            <button v-if="result.ingress_ip" type="button" class="btn-secondary" @click="copy(result.ingress_ip)">{{ copied ? 'Copied!' : 'Copy' }}</button>
          </div>
          <p class="muted">Until DNS is set, the cluster is reachable on its system hostname:</p>
          <code class="code-value small">{{ result.system_hostname || '—' }}</code>
        </template>
      </template>

      <!-- ── Standard ── -->
      <template v-else>
        <p v-if="provisioning" class="code-pending">⏳ Provisioning {{ created.subdomain }}.onecloudaway.de — this can take a few minutes…</p>
        <p v-else-if="slow" class="code-pending">⏳ {{ created.subdomain }}.onecloudaway.de is still provisioning. This is taking longer than usual; the code below is valid and the subdomain will come live shortly.</p>
        <p v-else class="code-ok">✓ {{ created.subdomain }}.onecloudaway.de is live.</p>
        <p class="muted">Share this access code with the customer — their users enter it once on the subdomain to join:</p>
        <div class="code-row">
          <code class="code-value">{{ created.signup_code }}</code>
          <button type="button" class="btn-secondary" @click="copy(created.signup_code)">{{ copied ? 'Copied!' : 'Copy' }}</button>
        </div>
      </template>

      <NuxtLink to="/admin" class="btn-primary">Done</NuxtLink>
    </div>

    <form v-else class="admin-form" @submit.prevent="submit">
      <label>
        Plan
        <select v-model="plan" :disabled="busy">
          <option value="standard">Standard</option>
          <option value="enterprise">Enterprise (dedicated cluster)</option>
        </select>
      </label>

      <label v-if="isEnterprise">
        Identifier
        <input v-model="subdomain" placeholder="acme" autocomplete="off" :disabled="busy" />
        <small class="muted">Internal slug for this enterprise tenant (2–31 chars, [a-z0-9-], starts with a letter). No public subdomain — the customer uses their own domain.</small>
      </label>
      <label v-else>
        Subdomain
        <div class="subdomain-input">
          <input v-model="subdomain" placeholder="tui" autocomplete="off" :disabled="busy" />
          <span class="suffix">.onecloudaway.de</span>
        </div>
        <small class="muted">2–31 chars, lowercase letters/digits/hyphens, starts with a letter.</small>
      </label>

      <label>
        Display name
        <input v-model="name" :placeholder="isEnterprise ? 'Acme Corp' : 'TUI Group'" :disabled="busy" />
      </label>

      <div v-if="error" class="form-error">{{ error }}</div>
      <div v-if="busy" class="loading">
        {{ isEnterprise ? `Starting dedicated cluster for ${subdomain}…` : `Provisioning ${subdomain}.onecloudaway.de — creating database pod…` }}
      </div>

      <button type="submit" class="btn-primary" :disabled="busy || !subdomain">
        {{ busy ? 'Provisioning…' : 'Create tenant' }}
      </button>
    </form>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()

const subdomain = ref('')
const name = ref('')
const plan = ref('standard')
const busy = ref(false)
const error = ref('')
const created = ref(null)
const result = ref(null)          // latest status payload (enterprise outputs/phase)
const provisioning = ref(false)   // status poll still returns 'provisioning'
const slow = ref(false)           // poll cap hit; job likely still running
const failed = ref(false)         // enterprise apply reported failure
const copied = ref(false)

const isEnterprise = computed(() => plan.value === 'enterprise')

const POLL_MS = 4000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Poll the (uncached) admin status route until the tenant flips live (or fails), or
// give up after the cap. Must be /api/admin/* — the gateway 404s every non-/api/admin
// path on the admin host. Enterprise cluster creation takes far longer than a pod, so
// it gets a 90-minute cap vs 8 for standard. The cap MUST be >= the provisioner Job's
// deadline (ENTERPRISE_TF_DEADLINE_SECONDS, default 5400s) — a shorter cap makes the SPA
// give up ("slow") while the create is still legitimately running.
async function pollUntilLive(id, enterprise) {
  const cap = (enterprise ? 90 : 8) * 60 * 1000
  const deadline = Date.now() + cap
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    try {
      const res = await apiFetch(`/api/admin/tenants/${id}`)
      result.value = res
      if (res?.status === 'live') { provisioning.value = false; return }
      if (res?.status === 'failed') { provisioning.value = false; failed.value = true; error.value = res.error || 'Provisioning failed'; return }
    } catch { /* transient — keep polling until the cap */ }
  }
  provisioning.value = false
  slow.value = true
}

async function submit() {
  busy.value = true
  error.value = ''
  failed.value = false
  try {
    const slug = subdomain.value.trim().toLowerCase()
    const body = isEnterprise.value
      ? { slug, name: name.value.trim(), plan: 'enterprise' }
      : { subdomain: slug, name: name.value.trim(), plan: plan.value }
    const res = await apiFetch('/api/admin/tenants', { method: 'POST', body })
    created.value = res.tenant   // standard: includes signup_code; enterprise: id/name/plan
    provisioning.value = true
    busy.value = false
    pollUntilLive(res.tenant.id, isEnterprise.value)
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Provisioning failed'
    busy.value = false
  }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); copied.value = true } catch { /* ignore */ }
}
</script>

<style scoped>
.admin-form { display: flex; flex-direction: column; gap: 1rem; max-width: 28rem; margin-top: 1rem; }
.admin-form label { display: flex; flex-direction: column; gap: 0.3rem; font-weight: 600; }
.admin-form input, .admin-form select { padding: 0.5rem; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; }
.subdomain-input { display: flex; align-items: center; gap: 0.4rem; }
.subdomain-input input { flex: 1; }
.subdomain-input .suffix { color: var(--muted, #6b7280); font-weight: 400; }
.muted { color: var(--muted, #6b7280); font-weight: 400; }
.created-card { display: flex; flex-direction: column; gap: 0.8rem; max-width: 28rem; margin-top: 1rem; padding: 1.2rem; border: 1px solid var(--border, #e5e7eb); border-radius: 12px; }
.code-ok { color: #16a34a; font-weight: 600; }
.code-pending { color: #b45309; font-weight: 600; }
.code-row { display: flex; align-items: center; gap: 0.6rem; }
.code-value { font-size: 1.2rem; letter-spacing: 0.15em; padding: 0.4rem 0.7rem; background: #f3f4f6; border-radius: 6px; }
.code-value.small { font-size: 0.95rem; letter-spacing: 0.02em; word-break: break-all; }
</style>
