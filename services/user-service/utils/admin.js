// Defense-in-depth admin guard. The gateway already restricts /api/admin to the
// admin host + operator email allowlist and stamps x-role=admin; we re-check the
// role here so a misrouted request can never mutate the control plane.
export function requireAdmin(event) {
  const role = event.context.user?.role
  if (role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Operator access required' })
  }
}

// Subdomain slug rules. Reserved labels collide with platform hosts.
const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/
const RESERVED = new Set(['admin', 'www', 'api', 'postgres', 'default'])

export function validateSubdomain(sub) {
  const s = String(sub || '').toLowerCase().trim()
  if (!SLUG_RE.test(s)) {
    throw createError({ statusCode: 400, statusMessage: 'subdomain must be 2-31 chars, [a-z0-9-], starting with a letter' })
  }
  if (RESERVED.has(s)) {
    throw createError({ statusCode: 400, statusMessage: `subdomain "${s}" is reserved` })
  }
  return s
}
