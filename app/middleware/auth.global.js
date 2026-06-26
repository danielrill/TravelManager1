export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return

  const { user, waitAuthReady } = useAuth()

  // Decide on a KNOWN auth state. Returning early while Firebase is still
  // restoring let a protected route render (or bounced a logged-in user to
  // /register), racing register.vue's redirect → /trips ↔ /register flicker.
  await waitAuthReady()

  const PROTECTED = ['/trips', '/profile', '/plan', '/admin']
  const isProtected = PROTECTED.some(p => to.path === p || to.path.startsWith(p + '/'))

  if (!isProtected) return

  if (!user.value) return navigateTo('/register')

  // /admin is operator-only; the gateway enforces the email allowlist server-side
  // (the page shows a 403 for non-operators), so client-side we just require login.

  // No profile on the admin host — skip the "complete your profile" redirect.
  if (useAdminHost()) return

  if ((!user.value.name || user.value.name.trim() === '') && to.path !== '/profile') {
    return navigateTo('/profile?setup=1')
  }
})
