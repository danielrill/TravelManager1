// POST /api/tenants/verify-code { code } — public pre-login gate. Checks the code
// against the CURRENT host tenant's signup_code (the gateway injects x-tenant-id
// from the subdomain). Returns { valid }. No auth, no membership — this only
// reveals the login form; actual membership is granted by POST /api/tenants/join
// after sign-in (which re-validates the code).
import { checkSignupCode } from '../../utils/tenants.js'

export default defineEventHandler(async (event) => {
  const { code } = await readBody(event)
  const tenantId = event.context.tenantId || 'default'
  if (tenantId === 'default') {
    // Apex/free needs no code.
    return { valid: false, reason: 'no code required' }
  }
  const valid = await checkSignupCode(tenantId, code)
  return { valid }
})
