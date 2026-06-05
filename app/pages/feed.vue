<!-- Personalized live feed (Social service). Standard+ plan. -->
<template>
  <div class="page-wrapper">
    <div class="page-header">
      <h2>Your Feed</h2>
      <div v-if="can('feed')" class="page-header-right">
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search your feed…"
            class="search-input"
            @input="onSearchInput"
          />
        </div>
      </div>
    </div>

    <SocialTabs />

    <UpgradePrompt v-if="!can('feed')" feature="feed" icon="📰" title="Your personal feed">
      A live feed of trips from travellers you follow is available on the
      <strong>{{ requiredPlanFor('feed') }}</strong> plan and above. You're on
      <strong>{{ planLabel }}</strong>.
    </UpgradePrompt>

    <template v-else>
    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-if="pending" class="loading">Loading your feed…</p>

    <div v-else-if="entries.length" class="trip-grid">
      <NuxtLink v-for="e in entries" :key="e.trip_id" :to="`/trips/${e.trip_id}`" class="trip-card">
        <div class="trip-card-title">{{ e.title }}</div>
        <div class="trip-card-meta">
          <span class="badge badge-dest">📍 {{ e.destination }}</span>
          <span class="badge badge-date">by {{ e.author_name }}</span>
        </div>
      </NuxtLink>
    </div>

    <div v-else-if="debouncedSearch" class="empty-state">
      <div class="empty-icon">🔍</div>
      <p>No trips in your feed match "{{ debouncedSearch }}".</p>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">📰</div>
      <p>Your feed is empty. Follow travellers and their new trips show up here.</p>
      <NuxtLink to="/discover" class="btn btn-gold" style="margin-top:16px">Find travellers to follow →</NuxtLink>
    </div>
    </template>
  </div>
</template>

<script setup>
const { apiFetch } = useApiFetch()
const { can, planLabel, requiredPlanFor } = usePlan()
const entries = ref([])
const pending = ref(true)
const error = ref('')

const searchQuery     = ref('')
const debouncedSearch = ref('')
let debounceTimer = null

function onSearchInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedSearch.value = searchQuery.value }, 350)
}

async function fetchFeed() {
  // Proactively gated: skip the call entirely if the plan can't use the feed.
  if (!can('feed')) { pending.value = false; return }
  pending.value = true
  error.value = ''
  try {
    const url = debouncedSearch.value
      ? `/api/feed?q=${encodeURIComponent(debouncedSearch.value)}`
      : '/api/feed'
    entries.value = await apiFetch(url)
  } catch (err) {
    error.value = err?.data?.statusMessage || 'The feed requires the Standard plan or higher.'
  } finally {
    pending.value = false
  }
}

onMounted(fetchFeed)
watch(debouncedSearch, fetchFeed)
</script>

<style scoped>
.empty-icon { font-size: 2.6rem; margin-bottom: 8px; }

.page-header-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.search-bar { position: relative; }
.search-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  font-size: 0.85rem; pointer-events: none;
}
.search-input {
  padding: 9px 16px 9px 36px;
  border: 2px solid var(--sand-dark);
  border-radius: 100px;
  font-size: 0.88rem;
  font-family: inherit;
  background: var(--white);
  color: var(--text);
  width: 220px;
  transition: border-color 0.2s, width 0.2s;
}
.search-input:focus { outline: none; border-color: var(--gold); width: 280px; }

@media (max-width: 600px) {
  .search-input { width: 160px; }
  .search-input:focus { width: 200px; }
}
</style>
