<!-- Operator onboarding console (admin.onecloudaway.de). Lists tenants and links
     to the create flow. The gateway gates /api/admin to the admin host + the
     operator email allowlist, so a non-operator just sees a 403 here. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <h2>Tenant Administration</h2>
      <div class="header-actions">
        <NuxtLink to="/admin/billing" class="btn-secondary">Billing</NuxtLink>
        <NuxtLink to="/admin/rate-cards" class="btn-secondary">Rate cards</NuxtLink>
        <NuxtLink to="/admin/new" class="btn-primary">+ New tenant</NuxtLink>
      </div>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="loading" class="loading">Loading tenants…</div>

    <table v-else class="admin-table">
      <thead>
        <tr>
          <th>Endpoint</th>
          <th>Name</th>
          <th>Plan</th>
          <th>Status</th>
          <th>Access code</th>
          <th>Rate limit</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in tenants" :key="t.id">
          <td>
            <code v-if="t.subdomain">{{ t.subdomain }}.onecloudaway.de</code>
            <template v-else-if="t.plan === 'enterprise'">
              <code v-if="t.custom_domain">{{ t.custom_domain }}</code>
              <code v-else-if="t.system_hostname">{{ t.system_hostname }}</code>
              <code v-else-if="t.ingress_ip">{{ t.ingress_ip }}</code>
              <span v-else class="muted">{{ t.id }} (dedicated cluster)</span>
            </template>
            <span v-else class="muted">onecloudaway.de (free)</span>
          </td>
          <td>{{ t.name }}</td>
          <td><span class="plan-pill" :class="`plan-${t.plan}`">{{ t.plan }}</span></td>
          <td>
            <span v-if="t.tls_status === 'destroying'" class="status-pending">○ destroying…</span>
            <span v-else-if="t.provisioned_at" class="status-live">● live</span>
            <span v-else class="status-pending">○ provisioning…</span>
          </td>
          <td>
            <button v-if="t.signup_code" type="button" class="code-btn" @click="copy(t.signup_code)">
              {{ copiedCode === t.signup_code ? 'copied!' : t.signup_code }}
            </button>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ t.rate_limit_per_min ?? 'plan default' }}</td>
          <td>
            <button v-if="t.id !== 'default'" type="button" class="del-btn"
                    :disabled="deleting === t.id" @click="remove(t)">
              {{ deleting === t.id ? 'Deleting…' : 'Delete' }}
            </button>
          </td>
        </tr>
        <tr v-if="!tenants.length">
          <td colspan="7" class="muted">No tenants yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const { user, authReady } = useAuth()
const tenants = ref([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    tenants.value = await apiFetch('/api/admin/tenants')
  } catch (e) {
    const code = e?.statusCode || e?.response?.status
    error.value = code === 403
      ? 'Operator access required. Your account is not on the allowlist.'
      : code === 401
        ? 'Please sign in as an operator to manage tenants.'
        : (e?.data?.statusMessage || e?.message || 'Failed to load tenants')
  } finally {
    loading.value = false
  }
}

const copiedCode = ref('')
async function copy(code) {
  try { await navigator.clipboard.writeText(code); copiedCode.value = code } catch { /* ignore */ }
}

const deleting = ref('')
async function remove(t) {
  const enterprise = t.plan === 'enterprise'
  if (enterprise) {
    // Tearing down a dedicated cluster destroys a GKE cluster + Cloud SQL and is slow
    // + irreversible — require the operator to type the id to confirm.
    const typed = prompt(`Tear down enterprise tenant "${t.id}"? This DESTROYS its dedicated GKE cluster and Cloud SQL (all data) and cannot be undone.\n\nType the tenant id to confirm:`)
    if (typed !== t.id) return
  } else {
    const label = t.subdomain ? `${t.subdomain}.onecloudaway.de` : t.id
    if (!confirm(`Delete "${label}"? This destroys its database pod and ALL its data, and moves its members back to the free tier. This cannot be undone.`)) return
  }
  deleting.value = t.id
  error.value = ''
  try {
    const res = await apiFetch(`/api/admin/tenants/${t.id}`, { method: 'DELETE' })
    if (enterprise && res?.status === 'destroying') {
      // Live cluster: async destroy Job — keep the row, mark it destroying (status
      // finalizes the removal on the next poll/refresh once the cluster is gone).
      t.tls_status = 'destroying'
    } else {
      // Standard, or an enterprise tenant that never built (removed immediately).
      tenants.value = tenants.value.filter((x) => x.id !== t.id)
    }
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Delete failed'
  } finally {
    deleting.value = ''
  }
}

// Wait for Firebase to restore the session before calling the API — otherwise the
// request goes out token-less and the gateway returns 401. auth.global redirects
// to /register when there's no signed-in user.
watch([authReady, user], ([ready, u]) => { if (ready && u) load() }, { immediate: true })
</script>

<style scoped>
.header-actions { display: flex; align-items: center; gap: 0.8rem; }
.admin-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.admin-table th, .admin-table td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border, #e5e7eb); }
.admin-table th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b7280); }
.plan-pill { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; text-transform: capitalize; }
.plan-free { background: #f3f4f6; color: #374151; }
.plan-standard { background: #dbeafe; color: #1e40af; }
.plan-enterprise { background: #ede9fe; color: #5b21b6; }
.status-live { color: #16a34a; }
.status-pending { color: #d97706; }
.muted { color: var(--muted, #6b7280); }
code { font-size: 0.85rem; }
.code-btn { font-family: monospace; letter-spacing: 0.1em; padding: 0.2rem 0.5rem; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: #f9fafb; cursor: pointer; }
.code-btn:hover { background: #f3f4f6; }
.del-btn { padding: 0.25rem 0.6rem; border: 1px solid #fecaca; color: #dc2626; background: #fff; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
.del-btn:hover:not(:disabled) { background: #fef2f2; }
.del-btn:disabled { opacity: 0.6; cursor: default; }
</style>
