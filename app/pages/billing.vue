<!-- Tenant-facing usage & billing. Shows the signed-in tenant's own current-period
     usage and projected cost via GET /api/usage/current (gateway stamps tenant +
     plan from the token, so a tenant can only ever see its own bill). Free tier is
     unmetered and returns €0 with no lines. Read-only — the operator console
     (admin host) is where prices/overrides are managed. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <NuxtLink to="/trips" class="btn btn-back">← My Trips</NuxtLink>
    </div>

    <h2 class="title">Usage &amp; Billing</h2>

    <div v-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="loading" class="loading">Loading usage…</div>

    <template v-else-if="data">
      <div class="summary-card">
        <div class="summary-meta">
          <span class="plan-pill" :class="`plan-${data.plan}`">{{ data.plan }}</span>
          <span class="muted">Billing period {{ data.billingPeriod }}</span>
        </div>
        <div class="summary-total">
          <span class="muted">Projected this period</span>
          <strong>{{ centsToEur(data.totalCents) }}</strong>
        </div>
      </div>

      <p v-if="data.plan === 'free'" class="muted note">
        Your workspace is on the Free plan — usage is not metered and there is
        nothing to bill.
      </p>

      <table v-else class="usage-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th class="num">Used</th>
            <th class="num">Included</th>
            <th class="num">Overage</th>
            <th class="num">Unit rate</th>
            <th class="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in data.lines" :key="l.dimension">
            <td>{{ label(l.dimension) }}</td>
            <td class="num">{{ fmt(l.used) }}</td>
            <td class="num">{{ fmt(l.included) }}</td>
            <td class="num">{{ fmt(l.overage) }}</td>
            <td class="num">{{ centsToEur(l.unitRateCents) }}</td>
            <td class="num">{{ centsToEur(l.costCents) }}</td>
          </tr>
          <tr v-if="!data.lines?.length">
            <td colspan="6" class="muted">No usage recorded this period.</td>
          </tr>
        </tbody>
        <tfoot v-if="data.lines?.length">
          <tr>
            <td colspan="5" class="num total-label">Total</td>
            <td class="num"><strong>{{ centsToEur(data.totalCents) }}</strong></td>
          </tr>
        </tfoot>
      </table>

      <p class="muted note">
        Costs are projected from usage so far this month and finalize into an
        invoice at the start of next month.
      </p>
    </template>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const { user, authReady } = useAuth()

const data = ref(null)
const loading = ref(true)
const error = ref('')

const LABELS = {
  api_request: 'API requests',
  ai_recommendation: 'AI recommendations',
  active_seat: 'Active seats',
  trip_created: 'Trips created',
}
function label(d) {
  return LABELS[d] || d
}
function centsToEur(c) {
  return ((Number(c) || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}
function fmt(n) {
  return (Number(n) || 0).toLocaleString('de-DE')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await apiFetch('/api/usage/current')
  } catch (e) {
    const code = e?.statusCode || e?.response?.status
    error.value = code === 401
      ? 'Please sign in to view your usage.'
      : (e?.data?.statusMessage || e?.message || 'Failed to load usage')
  } finally {
    loading.value = false
  }
}

// Wait for Firebase to restore the session before the first call — otherwise the
// request goes out token-less and the gateway returns 401.
watch([authReady, user], ([ready, u]) => { if (ready && u) load() }, { immediate: true })
</script>

<style scoped>
.title { margin: 0.5rem 0 1.2rem; font-family: 'Playfair Display', serif; }
.summary-card {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  background: var(--white); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 1.2rem 1.4rem;
}
.summary-meta { display: flex; align-items: center; gap: 0.8rem; }
.summary-total { display: flex; flex-direction: column; align-items: flex-end; }
.summary-total strong { font-size: 1.6rem; color: var(--navy); }
.usage-table { width: 100%; border-collapse: collapse; margin-top: 1.4rem; }
.usage-table th, .usage-table td {
  text-align: left; padding: 0.6rem 0.8rem;
  border-bottom: 1px solid var(--sand-dark);
}
.usage-table th {
  font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-muted);
}
.usage-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.usage-table tfoot td { border-bottom: none; padding-top: 0.9rem; }
.total-label { color: var(--text-muted); }
.plan-pill { padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.75rem; text-transform: capitalize; }
.plan-free { background: #f3f4f6; color: #374151; }
.plan-standard { background: #dbeafe; color: #1e40af; }
.plan-enterprise { background: #ede9fe; color: #5b21b6; }
.muted { color: var(--text-muted); }
.note { margin-top: 1rem; font-size: 0.9rem; }
.loading { padding: 2rem 0; color: var(--text-muted); }
</style>
