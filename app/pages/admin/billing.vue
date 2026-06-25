<!-- Operator billing overview (admin.onecloudaway.de). One row per billable tenant
     with its projected cost for the selected period; expand a row for the per-
     dimension breakdown + invoice history. Read-only — prices already reflect each
     tenant's negotiated overrides (projectCost). Gateway gates /api/admin to the
     admin host + operator allowlist, so a non-operator just sees a 403 here. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <h2>Billing Overview</h2>
      <div class="header-actions">
        <select v-model="period" class="period-select" :disabled="loading">
          <option v-for="p in periodOptions" :key="p" :value="p">{{ p }}</option>
        </select>
        <NuxtLink to="/admin/rate-cards" class="btn-secondary">Rate cards</NuxtLink>
        <NuxtLink to="/admin" class="btn-secondary">← Back</NuxtLink>
      </div>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="loading" class="loading">Loading billing…</div>

    <template v-else>
      <p class="summary">
        Projected revenue <strong>{{ period }}</strong>:
        <strong>{{ centsToEur(totalCents) }}</strong>
        <span class="muted"> across {{ rows.length }} billable tenant{{ rows.length === 1 ? '' : 's' }}</span>
      </p>

      <table class="admin-table">
        <thead>
          <tr>
            <th></th>
            <th>Subdomain</th>
            <th>Name</th>
            <th>Plan</th>
            <th class="num">Current cost</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="t in rows" :key="t.tenantId">
            <tr class="row-main" @click="toggle(t.tenantId)">
              <td class="caret">{{ expanded === t.tenantId ? '▾' : '▸' }}</td>
              <td>
                <code v-if="t.subdomain">{{ t.subdomain }}.onecloudaway.de</code>
                <span v-else class="muted">{{ t.tenantId }}</span>
              </td>
              <td>{{ t.name }}</td>
              <td><span class="plan-pill" :class="`plan-${t.plan}`">{{ t.plan }}</span></td>
              <td class="num">{{ centsToEur(t.totalCents) }}</td>
            </tr>

            <tr v-if="expanded === t.tenantId" class="row-detail">
              <td></td>
              <td colspan="4">
                <div v-if="detailLoading" class="loading">Loading detail…</div>
                <div v-else-if="detail">
                  <h4>Usage breakdown</h4>
                  <table class="detail-table">
                    <thead>
                      <tr>
                        <th>Dimension</th>
                        <th class="num">Used</th>
                        <th class="num">Included</th>
                        <th class="num">Overage</th>
                        <th class="num">Unit rate</th>
                        <th class="num">Line cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="l in detail.lines" :key="l.dimension">
                        <td>{{ l.dimension }}</td>
                        <td class="num">{{ fmt(l.used) }}</td>
                        <td class="num">{{ fmt(l.included) }}</td>
                        <td class="num">{{ fmt(l.overage) }}</td>
                        <td class="num">{{ centsToEur(l.unitRateCents) }}</td>
                        <td class="num">{{ centsToEur(l.costCents) }}</td>
                      </tr>
                      <tr v-if="!detail.lines?.length">
                        <td colspan="6" class="muted">No usage this period.</td>
                      </tr>
                    </tbody>
                  </table>

                  <h4>Recent invoices</h4>
                  <table class="detail-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Plan</th>
                        <th class="num">Total</th>
                        <th>Finalized</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="inv in detail.invoices" :key="inv.billing_period">
                        <td>{{ inv.billing_period }}</td>
                        <td>{{ inv.plan }}</td>
                        <td class="num">{{ centsToEur(inv.total_cents) }}</td>
                        <td class="muted">{{ new Date(inv.finalized_at).toLocaleDateString() }}</td>
                      </tr>
                      <tr v-if="!detail.invoices?.length">
                        <td colspan="4" class="muted">No finalized invoices yet.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </template>

          <tr v-if="!rows.length">
            <td colspan="5" class="muted">No billable tenants.</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const { user, authReady } = useAuth()

const rows = ref([])
const totalCents = ref(0)
const loading = ref(true)
const error = ref('')

// Last 12 months as YYYY-MM (UTC), newest first; default = current period.
const periodOptions = computed(() => {
  const out = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
})
const period = ref(periodOptions.value[0])

function centsToEur(c) {
  return ((Number(c) || 0) / 100).toLocaleString('en', { style: 'currency', currency: 'EUR' })
}
function fmt(n) {
  return (Number(n) || 0).toLocaleString('en')
}

async function load() {
  loading.value = true
  error.value = ''
  expanded.value = ''
  try {
    const res = await apiFetch(`/api/admin/usage/bulk?period=${period.value}`)
    rows.value = res.tenants || []
    totalCents.value = res.totalCents || 0
  } catch (e) {
    const code = e?.statusCode || e?.response?.status
    error.value = code === 403
      ? 'Operator access required. Your account is not on the allowlist.'
      : code === 401
        ? 'Please sign in as an operator to view billing.'
        : (e?.data?.statusMessage || e?.message || 'Failed to load billing')
  } finally {
    loading.value = false
  }
}

// Per-tenant drill-down: fetch the full projection + invoices once, cache it.
const expanded = ref('')
const detail = ref(null)
const detailLoading = ref(false)
const detailCache = new Map()

async function toggle(tenantId) {
  if (expanded.value === tenantId) { expanded.value = ''; return }
  expanded.value = tenantId
  const key = `${tenantId}:${period.value}`
  if (detailCache.has(key)) { detail.value = detailCache.get(key); return }
  detail.value = null
  detailLoading.value = true
  try {
    const res = await apiFetch(`/api/admin/usage/${tenantId}?period=${period.value}`)
    detailCache.set(key, res)
    detail.value = res
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Failed to load tenant detail'
    expanded.value = ''
  } finally {
    detailLoading.value = false
  }
}

// Reload when the period changes; clear the detail cache so figures stay in sync.
watch(period, () => { detailCache.clear(); if (authReady.value && user.value) load() })

// Wait for Firebase to restore the session before the first call — otherwise the
// request goes out token-less and the gateway returns 401.
watch([authReady, user], ([ready, u]) => { if (ready && u) load() }, { immediate: true })
</script>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.header-actions { display: flex; align-items: center; gap: 0.8rem; }
.period-select { padding: 0.4rem 0.6rem; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; }
.summary { margin: 1rem 0 0.5rem; }
.admin-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.admin-table th, .admin-table td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border, #e5e7eb); }
.admin-table th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b7280); }
.admin-table .num, .detail-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.row-main { cursor: pointer; }
.row-main:hover { background: #f9fafb; }
.caret { width: 1.5rem; color: var(--muted, #6b7280); }
.row-detail > td { background: #fafafa; padding: 0.8rem 0.8rem 1.2rem; }
.row-detail h4 { margin: 0.8rem 0 0.4rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b7280); }
.detail-table { width: 100%; border-collapse: collapse; }
.detail-table th, .detail-table td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border, #eee); font-size: 0.9rem; }
.plan-pill { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; text-transform: capitalize; }
.plan-free { background: #f3f4f6; color: #374151; }
.plan-standard { background: #dbeafe; color: #1e40af; }
.plan-enterprise { background: #ede9fe; color: #5b21b6; }
.muted { color: var(--muted, #6b7280); }
code { font-size: 0.85rem; }
</style>
