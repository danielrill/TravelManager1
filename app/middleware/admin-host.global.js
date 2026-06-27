// Host-based routing for the operator console. The admin subdomain
// (admin.onecloudaway.de / admin.localhost) IS the tenant-onboarding app, not a
// tenant of the product — so send it straight to /admin and keep /admin off any
// other host. useRequestURL() resolves the host on both server and client, so
// there's no normal-app flash before the redirect. Runs before auth.global.js
// (alphabetical), which then enforces login on /admin.
export default defineNuxtRouteMiddleware((to) => {
  const host = useRequestURL().hostname
  const isAdminHost = host.split('.')[0] === 'admin'

  // Only land the ROOT path on the console — leave /register, /profile, etc.
  // reachable so the operator can actually log in (auth.global then guards /admin).
  // Redirecting every non-/admin path would trap the login page in a loop.
  if (isAdminHost && to.path === '/') {
    return navigateTo('/admin')
  }
  // Product-only pages don't exist on the console host: the gateway serves no
  // /api/trips|/api/plan|tenant data here, so /trips' load fails and it bounces to
  // /register, which (when logged in) redirects back to /trips → flicker loop. After
  // login, register.vue/index.vue hardcode navigateTo('/trips'); catch those product
  // paths here (before the page mounts) and land the operator on /admin instead.
  const PRODUCT_ONLY = ['/trips', '/plan', '/join']
  if (isAdminHost && PRODUCT_ONLY.some(p => to.path === p || to.path.startsWith(p + '/'))) {
    return navigateTo('/admin')
  }
  if (!isAdminHost && to.path.startsWith('/admin')) {
    return navigateTo('/')
  }
})
