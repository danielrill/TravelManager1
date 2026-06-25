<!-- Operator price book (admin.onecloudaway.de). Edit the per-plan rate cards and
     per-tenant negotiated overrides. Saving PUTs a NEW versioned row (effective
     now), so historical invoices keep the rate they were billed at. Gateway gates
     /api/admin to the admin host + operator allowlist. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <h2>Rate Cards</h2>
      <div class="header-actions">
        <NuxtLink to="/admin/billing" class="btn-secondary">Billing</NuxtLink>
        <NuxtLink to="/admin" class="btn-secondary">← Back</NuxtLink>
      </div>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>
    <div v-if="loading" class="loading">Loading rate cards…</div>

    <template v-if="!loading">
      <p class="muted note">
        Rates are in cents. A saved change creates a new effective-now version;
        finalized invoices keep their original rate.
      </p>

      <!-- Plan price book -->
      <section v-for="plan in PLAN_KEYS" :key="plan" class="card">
        <div class="card-head">
          <h3><span class="plan-pill" :class="`plan-${plan}`">{{ plan }}</span> plan</h3>
          <button class="btn-primary" :disabled="savingPlan === plan" @click="savePlan(plan)">
            {{ savingPlan === plan ? 'Saving…' : 'Save plan' }}
          </button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Dimension</th>
              <th class="num">Included qty</th>
              <th class="num">Unit rate (¢)</th>
              <th class="num">Base fee (¢)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in DIMENSIONS" :key="d">
              <td>{{ d }}</td>
              <td class="num"><input v-model.number="planCards[plan][d].includedQty" type="number" min="0" step="1" /></td>
              <td class="num"><input v-model.number="planCards[plan][d].unitRateCents" type="number" min="0" step="0.001" /></td>
              <td class="num"><input v-model.number="planCards[plan][d].baseFeeCents" type="number" min="0" step="1" /></td>
            </tr>
          </tbody>
        </table>
        <p v-if="planMsg[plan]" class="ok-msg">{{ planMsg[plan] }}</p>
      </section>

      <!-- Per-tenant overrides -->
      <section class="card">
        <div class="card-head">
          <h3>Per-tenant overrides</h3>
        </div>
        <p class="muted">
          Negotiated rates layered on top of the tenant's plan card. Leave a field
          blank to inherit the plan value.
        </p>

        <div class="ov-form">
          <label>
            Tenant
            <select v-model="ovTenant">
              <option value="" disabled>Select a tenant…</option>
              <option v-for="t in billableTenants" :key="t.id" :value="t.id">
                {{ t.subdomain ? `${t.subdomain} (${t.plan})` : `${t.id} (${t.plan})` }}
              </option>
            </select>
          </label>

          <table v-if="ovTenant" class="admin-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th class="num">Included qty</th>
                <th class="num">Unit rate (¢)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in DIMENSIONS" :key="d">
                <td>{{ d }}</td>
                <td class="num"><input v-model="ovDraft[d].includedQty" type="number" min="0" step="1" placeholder="inherit" /></td>
                <td class="num"><input v-model="ovDraft[d].unitRateCents" type="number" min="0" step="0.001" placeholder="inherit" /></td>
              </tr>
            </tbody>
          </table>

          <button v-if="ovTenant" class="btn-primary" :disabled="savingOv" @click="saveOverrides">
            {{ savingOv ? 'Saving…' : 'Save overrides' }}
          </button>
          <p v-if="ovMsg" class="ok-msg">{{ ovMsg }}</p>
        </div>

        <h4 class="sub">Current overrides</h4>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Dimension</th>
              <th class="num">Included qty</th>
              <th class="num">Unit rate (¢)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in overrides" :key="`${o.tenant_id}:${o.dimension}`">
              <td>{{ o.tenant_id }}</td>
              <td>{{ o.dimension }}</td>
              <td class="num">{{ o.included_qty ?? '— inherit' }}</td>
              <td class="num">{{ o.unit_rate_cents ?? '— inherit' }}</td>
            </tr>
            <tr v-if="!overrides.length">
              <td colspan="4" class="muted">No overrides set.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const { user, authReady } = useAuth()

const DIMENSIONS = ['api_request', 'ai_recommendation', 'active_seat', 'trip_created']
const PLAN_KEYS = ['standard', 'enterprise']

const loading = ref(true)
const error = ref('')

// Editable plan cards: { standard: { dim: { includedQty, unitRateCents, baseFeeCents } } }.
function emptyPlanCards() {
  const out = {}
  for (const p of PLAN_KEYS) {
    out[p] = {}
    for (const d of DIMENSIONS) out[p][d] = { includedQty: 0, unitRateCents: 0, baseFeeCents: 0 }
  }
  return out
}
const planCards = ref(emptyPlanCards())
const overrides = ref([])
const billableTenants = ref([])

const savingPlan = ref('')
const planMsg = ref({})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [rc, tenants] = await Promise.all([
      apiFetch('/api/admin/rate-cards'),
      apiFetch('/api/admin/tenants'),
    ])
    const fresh = emptyPlanCards()
    for (const c of rc.cards || []) {
      if (fresh[c.plan]?.[c.dimension]) {
        fresh[c.plan][c.dimension] = {
          includedQty: Number(c.included_qty),
          unitRateCents: Number(c.unit_rate_cents),
          baseFeeCents: Number(c.base_fee_cents),
        }
      }
    }
    planCards.value = fresh
    overrides.value = rc.overrides || []
    billableTenants.value = (tenants || []).filter((t) => t.id !== 'default' && t.plan !== 'free')
  } catch (e) {
    const code = e?.statusCode || e?.response?.status
    error.value = code === 403
      ? 'Operator access required. Your account is not on the allowlist.'
      : code === 401
        ? 'Please sign in as an operator to manage rate cards.'
        : (e?.data?.statusMessage || e?.message || 'Failed to load rate cards')
  } finally {
    loading.value = false
  }
}

async function savePlan(plan) {
  savingPlan.value = plan
  planMsg.value = { ...planMsg.value, [plan]: '' }
  error.value = ''
  try {
    const lines = {}
    for (const d of DIMENSIONS) {
      const l = planCards.value[plan][d]
      lines[d] = {
        includedQty: Number(l.includedQty) || 0,
        unitRateCents: Number(l.unitRateCents) || 0,
        baseFeeCents: Number(l.baseFeeCents) || 0,
      }
    }
    await apiFetch(`/api/admin/rate-cards/${plan}`, { method: 'PUT', body: { lines } })
    planMsg.value = { ...planMsg.value, [plan]: '✓ Saved.' }
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Save failed'
  } finally {
    savingPlan.value = ''
  }
}

// Overrides editor: blank input = inherit (omit the field).
const ovTenant = ref('')
const savingOv = ref(false)
const ovMsg = ref('')
function emptyDraft() {
  const out = {}
  for (const d of DIMENSIONS) out[d] = { includedQty: '', unitRateCents: '' }
  return out
}
const ovDraft = ref(emptyDraft())

// Prefill the draft from existing overrides when a tenant is selected.
watch(ovTenant, (id) => {
  ovMsg.value = ''
  const draft = emptyDraft()
  for (const o of overrides.value) {
    if (o.tenant_id === id) {
      draft[o.dimension] = {
        includedQty: o.included_qty ?? '',
        unitRateCents: o.unit_rate_cents ?? '',
      }
    }
  }
  ovDraft.value = draft
})

async function saveOverrides() {
  if (!ovTenant.value) return
  savingOv.value = true
  ovMsg.value = ''
  error.value = ''
  try {
    const lines = {}
    for (const d of DIMENSIONS) {
      const l = ovDraft.value[d]
      const inc = l.includedQty === '' || l.includedQty == null ? null : Number(l.includedQty)
      const rate = l.unitRateCents === '' || l.unitRateCents == null ? null : Number(l.unitRateCents)
      if (inc != null || rate != null) lines[d] = { includedQty: inc, unitRateCents: rate }
    }
    if (!Object.keys(lines).length) { ovMsg.value = 'Nothing to save (all fields blank).'; return }
    await apiFetch(`/api/admin/rate-cards/overrides/${ovTenant.value}`, { method: 'PUT', body: { lines } })
    ovMsg.value = '✓ Saved.'
    await load() // refresh the current-overrides table
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Save failed'
  } finally {
    savingOv.value = false
  }
}

// Wait for Firebase to restore the session before the first call (else 401).
watch([authReady, user], ([ready, u]) => { if (ready && u) load() }, { immediate: true })
</script>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.header-actions { display: flex; align-items: center; gap: 0.8rem; }
.note { margin: 0.5rem 0 1rem; }
.card { border: 1px solid var(--border, #e5e7eb); border-radius: 12px; padding: 1rem 1.2rem; margin-bottom: 1.5rem; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-head h3 { margin: 0; }
.admin-table { width: 100%; border-collapse: collapse; margin-top: 0.8rem; }
.admin-table th, .admin-table td { text-align: left; padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--border, #e5e7eb); }
.admin-table th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b7280); }
.admin-table .num { text-align: right; }
.admin-table input { width: 8rem; padding: 0.35rem 0.5rem; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; text-align: right; font-variant-numeric: tabular-nums; }
.ov-form { display: flex; flex-direction: column; gap: 0.8rem; max-width: 40rem; margin-top: 0.8rem; }
.ov-form label { display: flex; flex-direction: column; gap: 0.3rem; font-weight: 600; max-width: 22rem; }
.ov-form select { padding: 0.5rem; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; }
.sub { margin: 1.5rem 0 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b7280); }
.plan-pill { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; text-transform: capitalize; }
.plan-standard { background: #dbeafe; color: #1e40af; }
.plan-enterprise { background: #ede9fe; color: #5b21b6; }
.ok-msg { color: #16a34a; font-weight: 600; margin-top: 0.6rem; }
.muted { color: var(--muted, #6b7280); }
</style>
