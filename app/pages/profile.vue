<template>
  <div class="page-wrapper">
    <div class="page-header">
      <NuxtLink to="/trips" class="btn btn-back">← My Trips</NuxtLink>
    </div>

    <div v-if="$route.query.setup" class="setup-banner">
      Welcome! Complete your profile to get started.
    </div>

    <div v-if="pending" class="loading">Loading profile…</div>

    <template v-else-if="profile">
      <!-- ── Profile card ── -->
      <div class="profile-card">

        <!-- Hero -->
        <div class="profile-hero">
          <div class="profile-hero-bg"></div>
          <div class="profile-hero-content">

            <!-- Avatar with upload overlay -->
            <div class="avatar-wrapper" @click="triggerAvatarPick" :title="'Change profile photo'">
              <img
                v-if="profile.avatar_url"
                :src="profile.avatar_url"
                class="profile-avatar profile-avatar-img"
                alt="Profile photo"
              />
              <div
                v-else
                class="profile-avatar"
                :style="{ background: avatarGradient }"
              >
                {{ profile.name.charAt(0).toUpperCase() }}
              </div>
              <div class="avatar-overlay">
                <span v-if="avatarUploading" class="avatar-overlay-spinner">⏳</span>
                <span v-else class="avatar-overlay-icon">📷</span>
              </div>
            </div>
            <input
              ref="avatarInput"
              type="file"
              accept="image/*"
              style="display:none"
              @change="onAvatarFileChange"
            />

            <div class="profile-meta" v-if="!editing">
              <h1 class="profile-name">{{ profile.name }}</h1>
              <p class="profile-email">{{ profile.email }}</p>
              <p class="profile-location" v-if="profile.home_city">
                <span class="location-icon">📍</span> {{ profile.home_city }}
              </p>
              <p class="profile-since">Member since {{ memberSince }}</p>
            </div>

            <div class="profile-hero-actions" v-if="!editing">
              <div v-if="avatarError" class="avatar-error">{{ avatarError }}</div>
              <button class="btn btn-edit-profile" @click="startEdit">
                Edit Profile
              </button>
              <button
                v-if="profile.avatar_url"
                class="btn btn-remove-avatar"
                @click.stop="removeAvatar"
                :disabled="avatarUploading"
                title="Remove profile photo"
              >
                ✕ Remove Photo
              </button>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="profile-stats">
          <div class="stat-item">
            <span class="stat-value">{{ trips.length }}</span>
            <span class="stat-label">{{ trips.length === 1 ? 'Trip' : 'Trips' }}</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <span class="stat-value">{{ uniqueDestinations }}</span>
            <span class="stat-label">{{ uniqueDestinations === 1 ? 'Destination' : 'Destinations' }}</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <span class="stat-value">{{ memberYear }}</span>
            <span class="stat-label">Member Since</span>
          </div>
        </div>

        <!-- View mode: bio -->
        <div class="profile-body" v-if="!editing">
          <div class="profile-section">
            <h3 class="section-label">About Me</h3>
            <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
            <p v-else class="profile-bio-empty">
              No bio yet —
              <button class="inline-link" @click="startEdit">add one to your profile.</button>
            </p>
          </div>
        </div>

        <!-- Edit mode -->
        <form v-else @submit.prevent="saveProfile" class="profile-edit-form">
          <div class="edit-form-grid">
            <div class="form-group">
              <label for="pf-name">Name <span class="required">*</span></label>
              <input
                id="pf-name"
                v-model="form.name"
                type="text"
                maxlength="100"
                required
                autofocus
                placeholder="Your full name"
              />
            </div>

            <div class="form-group">
              <label for="pf-city">Home City</label>
              <input
                id="pf-city"
                v-model="form.home_city"
                type="text"
                maxlength="100"
                placeholder="e.g. Vienna, Austria"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="pf-bio">
              About Me
              <span class="char-count" :class="{ warn: form.bio.length > 450 }">
                {{ form.bio.length }}/500
              </span>
            </label>
            <textarea
              id="pf-bio"
              v-model="form.bio"
              rows="5"
              maxlength="500"
              placeholder="Tell us about yourself and your passion for travel…"
            ></textarea>
          </div>

          <div class="form-error" v-if="saveError">{{ saveError }}</div>

          <div class="edit-actions">
            <button type="button" class="btn btn-secondary" @click="cancelEdit">
              Cancel
            </button>
            <button type="submit" class="btn btn-gold" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save Changes' }}
            </button>
          </div>
        </form>

      </div><!-- /.profile-card -->

      <!-- ── Plans / subscription ── -->
      <div class="plans-card">
        <div class="plans-head">
          <h3 class="section-label">Your Plan</h3>
          <span class="plans-current" :class="`plan-${planId}`">{{ planLabel }}</span>
        </div>
        <p class="plans-sub">
          Your workspace is on the <strong>{{ planLabel }}</strong> plan. Plans apply to
          everyone in your tenant and are managed by your account owner.
        </p>

        <div class="plan-grid">
          <div
            v-for="p in planList"
            :key="p.id"
            class="plan-col"
            :class="{ active: p.id === planId }"
          >
            <div class="plan-col-head">
              <span class="plan-col-name">{{ p.label }}</span>
              <span v-if="p.id === planId" class="plan-col-tag">Current</span>
            </div>
            <div class="plan-col-rate">{{ p.rateLimitPerMin.toLocaleString('de-DE') }} req/min</div>
            <ul class="plan-col-features">
              <li v-for="f in FEATURES" :key="f.key" :class="{ off: !p.features[f.key] }">
                <span class="feat-mark">{{ p.features[f.key] ? '✓' : '✗' }}</span>{{ f.label }}
              </li>
            </ul>
          </div>
        </div>

        <div class="plans-footer">
          <span class="plans-footer-text">Need more? Standard unlocks the personal feed, newsletter and white-label branding; Enterprise adds B2B partner insights and higher rate limits.</span>
          <a class="btn btn-gold" href="mailto:sales@onecloudaway.example?subject=Plan%20upgrade">Contact us to upgrade →</a>
        </div>
      </div>

      <!-- ── Create your own workspace (self-serve, free users only) ── -->
      <div v-if="planId === 'free'" class="workspace-card">
        <h3 class="section-label">Create your workspace</h3>
        <p class="workspace-sub">
          Upgrade to a <strong>Standard</strong> workspace — your own subdomain and
          dedicated database, on dedicated trip &amp; feed services. A one-time
          <strong>€29.99</strong> setup, then pay only for what you use — no monthly fee.
          Pick a name and complete the (mock) checkout.
        </p>

        <div v-if="!createdWorkspace" class="workspace-form">
          <label for="ws-sub">Workspace subdomain</label>
          <div class="ws-input-row">
            <input
              id="ws-sub"
              v-model="workspaceSub"
              type="text"
              placeholder="acme"
              maxlength="31"
              :disabled="creating"
              @input="wsError = ''"
            />
            <span class="ws-suffix">.{{ apexDomain }}</span>
          </div>
          <p class="ws-hint">2–31 chars, lowercase letters / numbers / hyphens, starting with a letter.</p>

          <div class="ws-pay">
            <div class="ws-pay-line"><span>Standard — one-time setup</span><span>€29.99</span></div>
            <div class="ws-pay-line ws-pay-sub"><span>Then pay-as-you-go</span><span>usage-based · no monthly fee</span></div>
            <p class="ws-mock-note">🔒 Mock checkout — no card required, nothing is charged.</p>
          </div>

          <div class="form-error" v-if="wsError">{{ wsError }}</div>
          <button
            class="btn btn-gold ws-submit"
            :disabled="creating || !workspaceSub"
            @click="createWorkspace"
          >
            {{ creating ? 'Provisioning…' : 'Pay €29.99 once — create workspace' }}
          </button>
          <p v-if="creating" class="ws-hint">Spinning up your database and pods — this can take a minute or two…</p>
        </div>

        <div v-else-if="provisioning" class="ws-provisioning">
          <p class="ws-success-msg">⏳ Setting up <strong>{{ createdWorkspace.tenant.name }}</strong>…</p>
          <p class="ws-hint">Spinning up your dedicated database and pods — this can take a minute or two. You can leave this page; provisioning continues.</p>
        </div>

        <div v-else class="ws-success">
          <p class="ws-success-msg">🎉 <strong>{{ createdWorkspace.tenant.name }}</strong> is live on its own pods.</p>

          <div v-if="createdWorkspace.tenant.signup_code" class="ws-code-box">
            <span class="ws-code-label">Invite access code</span>
            <div class="ws-code-row">
              <code class="ws-code">{{ createdWorkspace.tenant.signup_code }}</code>
              <button type="button" class="btn btn-secondary ws-copy" @click="copyCode">
                {{ codeCopied ? 'Copied ✓' : 'Copy' }}
              </button>
            </div>
            <p class="ws-code-hint">Share this with teammates — they enter it on your workspace to join. Keep it private.</p>
          </div>

          <a class="btn btn-gold" :href="createdWorkspace.url">Open {{ createdWorkspace.url }} →</a>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { getStorage, ref as storageRef, deleteObject } from 'firebase/storage'
const { user, setUser, waitAuthReady } = useAuth()
const { apiFetch } = useApiFetch()
const { uploadImage } = useImageUpload()
const { planId, planLabel, PLANS } = usePlan()

// Plan comparison table (read-only). Same matrix the gateway enforces.
const planList = computed(() => Object.values(PLANS))
const FEATURES = [
  { key: 'feed',       label: 'Personal feed' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'whiteLabel', label: 'White-label branding' },
  { key: 'b2bData',    label: 'B2B partner insights' },
]

const profile = ref(null)
const trips   = ref([])
const pending = ref(true)

onMounted(async () => {
  await waitAuthReady()
  if (!user.value) return navigateTo('/register')
  const uid = user.value.firebase_uid
  try {
    const [p, t] = await Promise.all([
      apiFetch(`/api/users/${uid}`),
      apiFetch('/api/trips'),
    ])
    profile.value = p
    trips.value   = t
  } finally {
    pending.value = false
  }
})

const safeTrips = computed(() => trips.value ?? [])

// ── Computed display values ──────────────────────────────────────────────────

const uniqueDestinations = computed(() => {
  const dests = safeTrips.value.map(t => t.destination.toLowerCase().trim())
  return new Set(dests).size
})

const memberSince = computed(() => {
  if (!profile.value?.created_at) return ''
  return new Date(profile.value.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
})

const memberYear = computed(() => {
  if (!profile.value?.created_at) return ''
  return new Date(profile.value.created_at).getFullYear()
})

// Deterministic gradient from name — keeps avatars consistent across sessions
const avatarGradient = computed(() => {
  const palettes = [
    ['#1a3260', '#c9a84c'],
    ['#2d6a4f', '#b7e4c7'],
    ['#6a1a4f', '#f4accd'],
    ['#1a4a6a', '#a8d8ea'],
    ['#4a3728', '#d4a26a'],
    ['#2d3561', '#a8d8ea'],
  ]
  const name = profile.value?.name ?? 'A'
  const idx = name.charCodeAt(0) % palettes.length
  const [from, to] = palettes[idx]
  return `linear-gradient(135deg, ${from}, ${to})`
})

// ── Avatar upload ────────────────────────────────────────────────────────────

const avatarInput    = ref(null)
const avatarUploading = ref(false)
const avatarError    = ref('')

function triggerAvatarPick() {
  if (avatarUploading.value) return
  avatarError.value = ''
  avatarInput.value?.click()
}

async function onAvatarFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''          // reset so same file can be re-picked
  if (!file) return
  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Please select an image file.'
    return
  }
  avatarUploading.value = true
  avatarError.value = ''
  try {
    const blob = await compressAvatarToBlob(file)
    const path = `avatars/${user.value.firebase_uid}/${Date.now()}.jpg`
    const url = await uploadImage(blob, path)
    await uploadAvatar(url)
  } catch (err) {
    avatarError.value = err.data?.statusMessage || err.message || 'Upload failed.'
  } finally {
    avatarUploading.value = false
  }
}

async function removeAvatar() {
  avatarUploading.value = true
  avatarError.value = ''
  try {
    const oldUrl = profile.value.avatar_url
    if (oldUrl?.includes('firebasestorage')) {
      const storage = getStorage()
      await deleteObject(storageRef(storage, oldUrl)).catch(() => {})
    }
    await uploadAvatar('')
  } catch (err) {
    avatarError.value = err.data?.statusMessage || err.message || 'Could not remove photo.'
  } finally {
    avatarUploading.value = false
  }
}

async function uploadAvatar(dataUrl) {
  const updated = await apiFetch(`/api/users/${user.value.firebase_uid}`, {
    method: 'PATCH',
    body: { avatar_url: dataUrl },
  })
  setUser(updated)
  Object.assign(profile.value, updated)
}

function compressAvatarToBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 320
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const w = Math.round(img.width  * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not compress image.'))
      }, 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')) }
    img.src = url
  })
}

// ── Self-serve workspace creation ────────────────────────────────────────────

const workspaceSub    = ref('')
const creating        = ref(false)
const provisioning    = ref(false)
const wsError         = ref('')
const createdWorkspace = ref(null)

// On the profile page the host IS the apex (free tenants live there), so the
// current host is the suffix shown after the chosen subdomain.
const apexDomain = computed(() => {
  if (typeof window === 'undefined') return 'onecloudaway.de'
  return window.location.host.replace(/^www\./, '')
})

const codeCopied = ref(false)

async function createWorkspace() {
  wsError.value = ''
  creating.value = true
  try {
    const res = await apiFetch('/api/tenants/self-serve', {
      method: 'POST',
      body: { subdomain: workspaceSub.value.trim().toLowerCase(), confirm: true },
    })
    createdWorkspace.value = res
    // Provisioning runs server-side in the background; poll until the workspace
    // goes live (dedicated pods take a minute or two to become ready).
    if (res.status === 'provisioning') {
      provisioning.value = true
      await pollProvisioned(res.tenant.id)
    }
  } catch (err) {
    wsError.value = err.data?.statusMessage || err.message || 'Could not create workspace.'
  } finally {
    creating.value = false
  }
}

async function pollProvisioned(id) {
  const deadline = Date.now() + 6 * 60 * 1000 // pods can take a few minutes
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000))
    try {
      const s = await apiFetch(`/api/tenants/${id}/status`)
      if (s.status === 'live') { provisioning.value = false; return }
    } catch { /* transient (pod rolling, cache) — keep polling */ }
  }
  // Timed out client-side; the job may still finish. Let the user retry/refresh.
  provisioning.value = false
  wsError.value = 'Provisioning is taking longer than expected — your workspace may still come online. Refresh in a few minutes.'
}

async function copyCode() {
  const code = createdWorkspace.value?.tenant?.signup_code
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 2000)
  } catch { /* clipboard blocked — user can select manually */ }
}

// ── Edit mode ────────────────────────────────────────────────────────────────

const editing = ref(false)
const saving  = ref(false)
const saveError = ref('')

const form = reactive({ name: '', bio: '', home_city: '' })

function startEdit() {
  form.name      = profile.value.name
  form.bio       = profile.value.bio ?? ''
  form.home_city = profile.value.home_city ?? ''
  saveError.value = ''
  editing.value  = true
}

function cancelEdit() {
  editing.value  = false
  saveError.value = ''
}

async function saveProfile() {
  saveError.value = ''
  saving.value    = true
  try {
    const updated = await apiFetch(`/api/users/${user.value.firebase_uid}`, {
      method: 'PUT',
      body: { name: form.name, bio: form.bio, home_city: form.home_city },
    })
    setUser(updated)
    Object.assign(profile.value, updated)
    editing.value = false
  } catch (err) {
    saveError.value = err.data?.statusMessage || err.message || 'Something went wrong'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* ── Setup banner ── */
.setup-banner {
  background: rgba(201,168,76,0.12);
  border: 1.5px solid rgba(201,168,76,0.35);
  border-radius: var(--radius);
  padding: 14px 20px;
  color: var(--navy);
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 20px;
  text-align: center;
}

/* ── Card ── */
.profile-card {
  background: var(--white);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* ── Hero ── */
.profile-hero {
  position: relative;
  padding: 0;
}
.profile-hero-bg {
  height: 120px;
  background: linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%);
  position: relative;
  overflow: hidden;
}
.profile-hero-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c9a84c' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
}
.profile-hero-content {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  padding: 0 40px 32px;
  position: relative;
  margin-top: -48px;
  flex-wrap: wrap;
}

/* ── Avatar upload ── */
.avatar-wrapper {
  position: relative;
  width: 96px;
  height: 96px;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 50%;
}
.avatar-wrapper:hover .avatar-overlay {
  opacity: 1;
}

.profile-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  border: 4px solid var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Playfair Display', serif;
  font-size: 2.6rem;
  font-weight: 700;
  color: var(--white);
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(15,31,61,0.2);
}
.profile-avatar-img {
  object-fit: cover;
  display: block;
}

.avatar-overlay {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(15,31,61,0.52);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
  border: 4px solid var(--white);
}
.avatar-overlay-icon {
  font-size: 1.6rem;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));
}
.avatar-overlay-spinner {
  font-size: 1.4rem;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.profile-hero-actions {
  margin-left: auto;
  margin-top: 52px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.avatar-error {
  font-size: 0.78rem;
  color: var(--error);
  text-align: right;
  max-width: 180px;
}
.btn-remove-avatar {
  padding: 6px 14px;
  background: none;
  border: 1.5px solid rgba(200,50,50,0.4);
  color: #c83232;
  border-radius: 100px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s, color 0.2s;
  white-space: nowrap;
}
.btn-remove-avatar:hover {
  background: #c83232;
  color: var(--white);
  border-color: #c83232;
}

.profile-meta {
  flex: 1;
  min-width: 0;
  padding-top: 52px;
}
.profile-name {
  font-family: 'Playfair Display', serif;
  font-size: 1.8rem;
  color: var(--navy);
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 4px;
}
.profile-email {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 4px;
}
.profile-location {
  color: var(--navy);
  font-size: 0.88rem;
  font-weight: 500;
  margin-bottom: 4px;
}
.location-icon { margin-right: 2px; }

.profile-since {
  color: var(--text-muted);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.btn-edit-profile {
  padding: 9px 22px;
  background: none;
  border: 1.5px solid var(--navy);
  color: var(--navy);
  border-radius: 100px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s, color 0.2s;
  white-space: nowrap;
}
.btn-edit-profile:hover {
  background: var(--navy);
  color: var(--white);
}

/* ── Stats ── */
.profile-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  border-top: 1px solid var(--sand-dark);
  border-bottom: 1px solid var(--sand-dark);
  padding: 24px 40px;
}
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
}
.stat-value {
  font-family: 'Playfair Display', serif;
  font-size: 2rem;
  font-weight: 700;
  color: var(--navy);
  line-height: 1;
}
.stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  font-weight: 500;
}
.stat-divider {
  width: 1px;
  height: 48px;
  background: var(--sand-dark);
  flex-shrink: 0;
}

/* ── Body / bio ── */
.profile-body {
  padding: 36px 40px;
}
.profile-section {
  margin-bottom: 0;
}
.section-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--gold);
  font-weight: 600;
  margin-bottom: 12px;
}
.profile-bio {
  color: var(--text);
  line-height: 1.8;
  white-space: pre-wrap;
  font-size: 0.95rem;
}
.profile-bio-empty {
  color: var(--text-muted);
  font-size: 0.9rem;
  font-style: italic;
}
.inline-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--gold);
  font-weight: 600;
  font-size: inherit;
  font-family: inherit;
  cursor: pointer;
  text-decoration: underline;
  font-style: normal;
}
.inline-link:hover { color: var(--navy); }

/* ── Edit form ── */
.profile-edit-form {
  padding: 36px 40px;
  border-top: 1px solid var(--sand-dark);
}
.edit-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
}

.form-group {
  margin-bottom: 22px;
}
.form-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--navy);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.required { color: var(--gold); }

.char-count {
  margin-left: auto;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.char-count.warn { color: var(--error); }

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 13px 16px;
  border: 2px solid var(--sand-dark);
  border-radius: 10px;
  font-size: 0.95rem;
  font-family: inherit;
  background: var(--sand);
  color: var(--text);
  transition: border-color 0.2s, background 0.2s;
  resize: none;
}
.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--gold);
  background: var(--white);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--sand-dark);
  margin-top: 4px;
}

/* ── Plans card ── */
.plans-card {
  background: var(--white);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 32px 40px;
  margin-top: 24px;
}
.plans-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.plans-head .section-label { margin-bottom: 0; }
.plans-current {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border-radius: 100px;
  line-height: 1;
}
.plan-free       { background: rgba(15,31,61,0.08); color: var(--text-muted); }
.plan-standard   { background: rgba(201,168,76,0.2); color: #8a6d20; }
.plan-enterprise { background: var(--gold); color: var(--navy); }

.plans-sub {
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 24px;
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.plan-col {
  border: 2px solid var(--sand-dark);
  border-radius: var(--radius);
  padding: 20px 18px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.plan-col.active {
  border-color: var(--gold);
  box-shadow: 0 4px 18px rgba(201,168,76,0.18);
}
.plan-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.plan-col-name {
  font-family: 'Playfair Display', serif;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--navy);
}
.plan-col-tag {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: var(--gold);
  color: var(--navy);
  padding: 2px 7px;
  border-radius: 100px;
}
.plan-col-rate {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 14px;
}
.plan-col-features {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plan-col-features li {
  font-size: 0.85rem;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.plan-col-features li.off { color: var(--text-muted); opacity: 0.7; }
.feat-mark {
  font-weight: 700;
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  color: var(--success);
}
.plan-col-features li.off .feat-mark { color: var(--text-muted); }

.plans-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 26px;
  padding-top: 22px;
  border-top: 1px solid var(--sand-dark);
}
.plans-footer-text { color: var(--text-muted); font-size: 0.85rem; flex: 1; min-width: 200px; }

/* ── Create workspace card ── */
.workspace-card {
  background: var(--white);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 32px 40px;
  margin-top: 24px;
}
.workspace-sub {
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.6;
  margin: 6px 0 22px;
}
.workspace-form label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--navy);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.ws-input-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  max-width: 420px;
}
.ws-input-row input {
  flex: 1;
  min-width: 0;
  padding: 13px 16px;
  border: 2px solid var(--sand-dark);
  border-right: none;
  border-radius: 10px 0 0 10px;
  font-size: 0.95rem;
  font-family: inherit;
  background: var(--sand);
  color: var(--text);
}
.ws-input-row input:focus { outline: none; border-color: var(--gold); background: var(--white); }
.ws-suffix {
  display: flex;
  align-items: center;
  padding: 0 14px;
  border: 2px solid var(--sand-dark);
  border-left: none;
  border-radius: 0 10px 10px 0;
  background: var(--sand-dark);
  color: var(--text-muted);
  font-size: 0.9rem;
  white-space: nowrap;
}
.ws-hint { color: var(--text-muted); font-size: 0.78rem; margin: 8px 0 0; }
.ws-pay {
  margin: 20px 0;
  padding: 16px 18px;
  border: 1.5px solid var(--sand-dark);
  border-radius: 12px;
  background: var(--sand);
}
.ws-pay-line {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
  color: var(--navy);
  font-size: 0.95rem;
}
.ws-mock-note { color: var(--text-muted); font-size: 0.78rem; margin: 8px 0 0; }
.ws-submit { margin-top: 4px; }
.ws-success-msg { color: var(--text); font-size: 1rem; margin-bottom: 14px; }
.ws-code-box {
  margin: 0 0 18px;
  padding: 16px 18px;
  border: 1.5px dashed var(--gold);
  border-radius: 12px;
  background: rgba(201,168,76,0.08);
}
.ws-code-label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--gold);
  font-weight: 600;
  margin-bottom: 8px;
}
.ws-code-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ws-code {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--navy);
  background: var(--white);
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--sand-dark);
}
.ws-copy { padding: 8px 16px; font-size: 0.82rem; }
.ws-code-hint { color: var(--text-muted); font-size: 0.78rem; margin: 10px 0 0; }

@media (max-width: 600px) {
  .workspace-card { padding: 24px 20px; }
  .ws-input-row { max-width: none; }
  .plans-card { padding: 24px 20px; }
  .plan-grid { grid-template-columns: 1fr; }
  .plans-footer .btn { width: 100%; justify-content: center; }
  .profile-hero-content { padding: 0 20px 28px; gap: 16px; }
  .profile-body,
  .profile-edit-form { padding: 28px 20px; }
  .profile-stats { padding: 20px; }
  .edit-form-grid { grid-template-columns: 1fr; gap: 0; }
  .profile-hero-actions { margin-top: 0; align-items: flex-start; }
  .btn-edit-profile { width: 100%; justify-content: center; }
  .profile-meta { padding-top: 8px; }
}
</style>
