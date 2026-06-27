<!-- Create + provision a standard tenant. POST /api/admin/tenants registers the
     tenant and detaches the provisioner (dedicated Postgres pod + databases + schemas
     + app pods), returning 202 immediately. Provisioning is minutes of work, so the
     page polls /api/tenants/:id/status until the subdomain comes live. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <h2>New Tenant</h2>
      <NuxtLink to="/admin" class="btn-secondary">← Back</NuxtLink>
    </div>

    <!-- Success: show the access code to hand to the customer. The code is valid
         immediately; the subdomain comes live once the pods finish spinning up. -->
    <div v-if="created" class="created-card">
      <p v-if="provisioning" class="code-pending">⏳ Provisioning {{ created.subdomain }}.onecloudaway.de — this can take a few minutes…</p>
      <p v-else-if="slow" class="code-pending">⏳ {{ created.subdomain }}.onecloudaway.de is still provisioning. This is taking longer than usual; the code below is valid and the subdomain will come live shortly.</p>
      <p v-else class="code-ok">✓ {{ created.subdomain }}.onecloudaway.de is live.</p>
      <p class="muted">Share this access code with the customer — their users enter it once on the subdomain to join:</p>
      <div class="code-row">
        <code class="code-value">{{ created.signup_code }}</code>
        <button type="button" class="btn-secondary" @click="copyCode">{{ copied ? 'Copied!' : 'Copy' }}</button>
      </div>
      <NuxtLink to="/admin" class="btn-primary">Done</NuxtLink>
    </div>

    <form v-else class="admin-form" @submit.prevent="submit">
      <label>
        Subdomain
        <div class="subdomain-input">
          <input v-model="subdomain" placeholder="tui" autocomplete="off" :disabled="busy" />
          <span class="suffix">.onecloudaway.de</span>
        </div>
        <small class="muted">2–31 chars, lowercase letters/digits/hyphens, starts with a letter.</small>
      </label>

      <label>
        Display name
        <input v-model="name" placeholder="TUI Group" :disabled="busy" />
      </label>

      <label>
        Plan
        <select v-model="plan" :disabled="busy">
          <option value="standard">Standard</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </label>

      <div v-if="error" class="form-error">{{ error }}</div>
      <div v-if="busy" class="loading">Provisioning {{ subdomain }}.onecloudaway.de — creating database pod…</div>

      <button type="submit" class="btn-primary" :disabled="busy || !subdomain">
        {{ busy ? 'Provisioning…' : 'Create tenant' }}
      </button>
    </form>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const router = useRouter()

const subdomain = ref('')
const name = ref('')
const plan = ref('standard')
const busy = ref(false)
const error = ref('')
const created = ref(null)
const provisioning = ref(false)  // status poll still returns 'provisioning'
const slow = ref(false)          // poll cap hit; job likely still running
const copied = ref(false)

const POLL_MS = 4000
const POLL_CAP_MS = 8 * 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Poll the (uncached) status endpoint until the tenant flips to live, or give up after
// the cap. A failed background job leaves it 'provisioning' forever, so cap and surface
// a non-fatal note rather than spinning indefinitely.
async function pollUntilLive(id) {
  const deadline = Date.now() + POLL_CAP_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    try {
      const res = await apiFetch(`/api/tenants/${id}/status`)
      if (res?.status === 'live') { provisioning.value = false; return }
    } catch { /* transient — keep polling until the cap */ }
  }
  provisioning.value = false
  slow.value = true
}

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const res = await apiFetch('/api/admin/tenants', {
      method: 'POST',
      body: { subdomain: subdomain.value.trim().toLowerCase(), name: name.value.trim(), plan: plan.value },
    })
    created.value = res.tenant   // includes signup_code (valid immediately)
    provisioning.value = true
    busy.value = false
    pollUntilLive(res.tenant.id)
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Provisioning failed'
    busy.value = false
  }
}

async function copyCode() {
  try { await navigator.clipboard.writeText(created.value.signup_code); copied.value = true } catch { /* ignore */ }
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
</style>
