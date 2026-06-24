// Defense-in-depth admin guard. The gateway already restricts /api/admin to the
// admin host + operator email allowlist and stamps x-role=admin; we re-check here
// so a misrouted request can never read/mutate billing config.
export function requireAdmin(event) {
  const role = event.context.user?.role
  if (role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Operator access required' })
  }
}
