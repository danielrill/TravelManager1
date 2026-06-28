<template>
  <div class="routes-block">
    <!-- Add form (owner only) -->
    <div v-if="isOwner" class="route-form-card">
      <h3>{{ editingId ? 'Edit route' : 'Add a route' }}</h3>
      <input
        v-model="form.title"
        type="text"
        maxlength="120"
        class="route-input"
        placeholder='e.g. "Camp Nou stadium tour"'
        @keyup.enter="save"
      />
      <textarea
        v-model="form.description"
        class="route-textarea"
        rows="2"
        placeholder="What did you do? (optional)"
      />
      <div class="route-form-actions">
        <button class="btn btn-gold btn-sm" :disabled="!form.title.trim() || saving" @click="save">
          {{ saving ? 'Saving…' : editingId ? 'Update' : 'Add Route' }}
        </button>
        <button v-if="editingId" class="btn-link-muted" @click="resetForm">Cancel</button>
      </div>
    </div>

    <!-- List -->
    <div v-if="routes.length" class="routes-list">
      <div v-for="r in routes" :key="r.id" class="route-card">
        <div class="route-card-body">
          <h4 class="route-card-title">{{ r.title }}</h4>
          <p v-if="r.description" class="route-card-desc">{{ r.description }}</p>
        </div>
        <div v-if="isOwner" class="route-card-actions">
          <button class="route-icon-btn" title="Edit" @click="startEdit(r)">✏</button>
          <button class="route-icon-btn route-icon-btn--danger" title="Delete" @click="remove(r)">✕</button>
        </div>
      </div>
    </div>
    <p v-else class="routes-empty">
      {{ isOwner ? 'No routes yet. Add the activities from this trip above.' : 'No routes shared for this trip yet.' }}
    </p>
  </div>
</template>

<script setup>
const props = defineProps({
  tripId: { type: [Number, String], required: true },
  isOwner: { type: Boolean, default: false },
})

const { apiFetch } = useApiFetch()
const { toastError, toastSuccess } = useToast()
const { confirm } = useConfirm()

const routes    = ref([])
const saving    = ref(false)
const editingId = ref(null)
const form      = reactive({ title: '', description: '' })

onMounted(fetchRoutes)

async function fetchRoutes() {
  routes.value = await apiFetch(`/api/trip-routes/trip/${props.tripId}`).catch(() => [])
}

function resetForm() {
  editingId.value = null
  form.title = ''
  form.description = ''
}

function startEdit(r) {
  editingId.value = r.id
  form.title = r.title
  form.description = r.description || ''
}

async function save() {
  if (!form.title.trim()) return
  saving.value = true
  try {
    if (editingId.value) {
      await apiFetch(`/api/trip-routes/${editingId.value}`, { method: 'PUT', body: { ...form } })
    } else {
      await apiFetch(`/api/trip-routes/trip/${props.tripId}`, { method: 'POST', body: { ...form } })
    }
    resetForm()
    await fetchRoutes()
  } catch (err) {
    toastError(err.data?.statusMessage || 'Could not save route')
  } finally {
    saving.value = false
  }
}

async function remove(r) {
  if (!(await confirm({ title: 'Delete route?', message: `"${r.title}" will be removed.`, confirmText: 'Delete', danger: true }))) return
  try {
    await apiFetch(`/api/trip-routes/${r.id}`, { method: 'DELETE' })
    if (editingId.value === r.id) resetForm()
    await fetchRoutes()
    toastSuccess('Route removed')
  } catch (err) {
    toastError(err.data?.statusMessage || 'Could not delete route')
  }
}
</script>

<style scoped>
.routes-block { display: flex; flex-direction: column; gap: 20px; }

.route-form-card {
  background: var(--sand);
  border-radius: 10px;
  padding: 20px 24px;
}
.route-form-card h3 {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--gold);
  font-weight: 700;
  margin-bottom: 12px;
}
.route-input,
.route-textarea {
  width: 100%;
  border: 1.5px solid var(--sand-dark);
  border-radius: 8px;
  padding: 10px 14px;
  font-family: inherit;
  font-size: 0.9rem;
  background: var(--white);
  color: var(--text);
  margin-bottom: 12px;
  transition: border-color 0.2s;
}
.route-textarea { resize: vertical; }
.route-input:focus,
.route-textarea:focus { outline: none; border-color: var(--gold); }
.route-form-actions { display: flex; align-items: center; gap: 16px; }
.btn-sm { padding: 7px 16px; font-size: 0.82rem; }
.btn-link-muted {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.82rem;
  cursor: pointer;
  font-family: inherit;
  text-decoration: underline;
}
.btn-link-muted:hover { color: var(--navy); }

.routes-list { display: flex; flex-direction: column; gap: 12px; }
.route-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--sand);
  border-radius: 10px;
  padding: 16px 20px;
}
.route-card-body { flex: 1; min-width: 0; }
.route-card-title {
  font-weight: 700;
  color: var(--navy);
  font-size: 0.98rem;
  margin-bottom: 4px;
}
.route-card-desc {
  color: #444;
  font-size: 0.88rem;
  line-height: 1.6;
  white-space: pre-wrap;
}
.route-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
.route-icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: color 0.2s, background 0.2s;
}
.route-icon-btn:hover { background: rgba(0,0,0,0.05); color: var(--navy); }
.route-icon-btn--danger:hover { color: var(--error); }

.routes-empty {
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: center;
  padding: 24px 0;
}
</style>
