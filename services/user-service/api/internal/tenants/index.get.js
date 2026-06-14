// GET /api/internal/tenants — list all tenants (control-plane). Internal only.
// Used by background jobs (forEachTenant) to iterate provisioned tenants, and by
// the admin onboarding UI to list workspaces. Includes plan + provisioning state.
import { listTenants } from '../../../utils/tenants.js'

export default defineEventHandler(async () => {
  return listTenants()
})
