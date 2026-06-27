<!-- Tenant access gate. A first-time visitor enters the access code the operator
     gave them BEFORE logging in. The code is verified, remembered per-tenant in
     localStorage, and the visitor is sent to the normal /register login page; on
     return (now signed in) the code is redeemed automatically. On any later visit
     from the same device the remembered code is re-validated/redeemed with no typing.
     The stored code self-clears if it stops working (rotated by the operator). -->
<template>
  <div class="join-wrap">
    <div class="join-card">
      <div class="join-badge">🔒</div>
      <h2>{{ tenant?.name || 'Private workspace' }}</h2>
      <p class="join-sub">Enter the access code your administrator gave you to join this workspace.</p>

      <form @submit.prevent="verify">
        <input
          v-model="code"
          class="code-field"
          placeholder="ACCESS CODE"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          :disabled="busy"
          @input="code = code.toUpperCase()"
        />
        <p v-if="error" class="form-error">{{ error }}</p>
        <button type="submit" class="btn-primary block" :disabled="busy || !code.trim()">
          {{ busy ? 'Checking…' : 'Continue' }}
        </button>
      </form>

      <p class="join-foot">Don’t have a code? Ask your workspace administrator.</p>
    </div>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const { user, authReady } = useAuth()

const tenant = useState('currentTenant', () => undefined)
const code = ref('')
const busy = ref(false)
const error = ref('')

// Per-tenant key: a device may hold codes for more than one workspace. Low-sensitivity
// (operator-shared, reusable workspace join code), so plaintext localStorage is fine;
// it self-clears on the first verify/join that fails (rotated code).
const keyFor = (id) => `tm_join_code:${id}`
const remember = () => { if (import.meta.client && tenant.value) localStorage.setItem(keyFor(tenant.value.id), code.value.trim()) }
const forget = () => { if (import.meta.client && tenant.value) localStorage.removeItem(keyFor(tenant.value.id)) }

async function init() {
  if (tenant.value === undefined) {
    try { tenant.value = await apiFetch('/api/tenants/current') } catch { tenant.value = null }
  }
  // Free apex or already a member → no gate.
  if (!tenant.value || tenant.value.id === 'default') return navigateTo('/')
  if (user.value && user.value.tenant_id === tenant.value.id) return navigateTo('/')

  // Remembered from a previous visit on this device → no typing.
  if (!import.meta.client) return
  const saved = localStorage.getItem(keyFor(tenant.value.id))
  if (!saved) return
  code.value = saved
  if (user.value) await join()   // signed in, not yet a member → redeem now
  else await verify()            // not signed in → re-validate, then on to /register
}

async function verify() {
  busy.value = true; error.value = ''
  try {
    const { valid } = await apiFetch('/api/tenants/verify-code', { method: 'POST', body: { code: code.value.trim() } })
    if (!valid) { forget(); error.value = 'That access code is not valid.'; return }
    remember()
    if (user.value) await join()            // already signed in → join now
    else navigateTo('/register')            // sign in on the normal page, then auto-redeem
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not verify code'
  } finally { busy.value = false }
}

async function join() {
  busy.value = true; error.value = ''
  try {
    await apiFetch('/api/tenants/join', { method: 'POST', body: { code: code.value.trim() } })
    remember()                              // keep it so the next visit is typing-free
    window.location.assign('/')             // hard reload so the profile re-hydrates as a member
  } catch (e) {
    forget()                                // stale/rotated code → drop it so the user can re-enter
    error.value = e?.data?.statusMessage || e?.message || 'Could not join — check the code with your administrator.'
  } finally { busy.value = false }
}

watch(authReady, (r) => { if (r) init() }, { immediate: true })
</script>

<style scoped>
.join-wrap { min-height: 75vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
.join-card {
  width: 100%; max-width: 24rem; text-align: center;
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 2rem 1.75rem;
  border: 1px solid var(--border, #e5e7eb); border-radius: 16px;
  background: var(--surface, #fff);
  box-shadow: 0 10px 30px rgba(0,0,0,0.06);
}
.join-badge { font-size: 2rem; }
.join-card h2 { margin: 0; font-size: 1.4rem; }
.join-sub { color: var(--muted, #6b7280); font-size: 0.92rem; margin: 0 0 0.4rem; }
.join-card form { display: flex; flex-direction: column; gap: 0.6rem; }
.code-field {
  width: 100%; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.35rem; font-weight: 600; letter-spacing: 0.35em;
  padding: 0.85rem 0.5rem; text-indent: 0.35em;
  border: 2px solid var(--border, #e5e7eb); border-radius: 10px;
  text-transform: uppercase; outline: none; transition: border-color 0.15s;
}
.code-field:focus { border-color: var(--gold, #b8860b); }
.code-field::placeholder { letter-spacing: 0.15em; font-weight: 400; color: #c4c4c4; }
.btn-primary.block { width: 100%; padding: 0.75rem; font-size: 1rem; }
.form-error { color: #dc2626; font-size: 0.88rem; margin: 0; }
.join-foot { color: var(--muted, #6b7280); font-size: 0.8rem; margin: 0.3rem 0 0; }
</style>
