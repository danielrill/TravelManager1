// GET /api/admin/tenants — list all tenants for the operator onboarding UI.
// Reached only via admin.onecloudaway.de (the gateway gates the admin host with
// the operator email allowlist and stamps x-role=admin).
import { listTenants } from '../../../utils/tenants.js'
import { requireAdmin } from '../../../utils/admin.js'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return listTenants()
})
