<template>
  <div class="err-page">
    <div class="err-card">
      <div class="err-logo">
        <img src="/logo_banner.png" alt="One Cloud Away" class="err-logo-img" />
      </div>
      <p class="err-code">{{ status }}</p>
      <h1 class="err-title">{{ isNotFound ? 'Workspace not found' : 'Something went wrong' }}</h1>
      <p class="err-msg">
        <template v-if="isNotFound">
          There’s no <strong>One Cloud Away</strong> workspace at this address.
          The subdomain may be misspelled or the workspace doesn’t exist.
        </template>
        <template v-else>
          {{ error?.statusMessage || 'An unexpected error occurred. Please try again.' }}
        </template>
      </p>
      <a class="err-btn" :href="apexUrl">Go to One Cloud Away →</a>
    </div>
  </div>
</template>

<script setup>
// Nuxt error boundary. Rendered INSTEAD of the app when showError() is called —
// notably by plugins/tenant.client.js when the host subdomain resolves to no
// tenant (gateway 404), so an unknown workspace shows "not found" rather than the
// login page. Self-contained styling (brand vars live in app.vue, which is not
// mounted here).
const props = defineProps({ error: Object })

const status = computed(() => props.error?.statusCode || 404)
const isNotFound = computed(() => status.value === 404)

// Apex = the host minus its left-most (subdomain) label, e.g.
// cloud.onecloudaway.de -> onecloudaway.de. Falls back to the apex domain.
const apexUrl = computed(() => {
  if (typeof window === 'undefined') return 'https://onecloudaway.de'
  const host = window.location.host
  const parts = host.split('.')
  const apex = parts.length > 2 ? parts.slice(1).join('.') : host
  return `${window.location.protocol}//${apex}`
})

useHead({
  title: computed(() => (isNotFound.value ? 'Workspace not found · One Cloud Away' : 'Error · One Cloud Away')),
  link: [{ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap' }],
})
</script>

<style>
/* NOT scoped: error.vue replaces app.vue entirely (none of app.vue's global
   reset/:root vars load here), and a scoped rule on the root element doesn't
   reliably apply on the Nuxt error page. Class names are unique (err-*). */
html, body { margin: 0; padding: 0; }
.err-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: #0f1f3d; /* --navy */
}
.err-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 48px 44px 40px;
  width: 100%;
  max-width: 460px;
  text-align: center;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.4);
  animation: fadeUp 0.45s ease;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
.err-logo-img {
  height: 56px;
  width: auto;
  max-width: 220px;
  object-fit: contain;
  margin-bottom: 18px;
}
.err-code {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 3.25rem;
  line-height: 1;
  color: #c9a84c; /* --gold */
  margin-bottom: 6px;
}
.err-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 1.6rem;
  color: #0f1f3d; /* --navy */
  margin-bottom: 12px;
}
.err-msg {
  color: #7a7a7a; /* --text-muted */
  font-size: 0.95rem;
  line-height: 1.55;
  margin-bottom: 28px;
}
.err-btn {
  display: inline-block;
  background: #0f1f3d;
  color: #fff;
  text-decoration: none;
  padding: 12px 24px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.9rem;
  transition: background 0.2s;
}
.err-btn:hover { background: #1a2f55; }
</style>
