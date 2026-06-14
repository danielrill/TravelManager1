export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return

  const { user, authReady } = useAuth()

  if (!authReady.value) return

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
