// GET /api/admin/tenants/:id — provisioning status for the operator console. The
// admin host (admin.onecloudaway.de) only proxies /api/admin/* through the gateway,
// so the SPA's New-Tenant page polls THIS route (not /api/tenants/:id/status, which
// the gateway 404s on the admin host) to watch a freshly-created tenant flip live.
// Uncached: provisioned_at flips mid-provision while the dedicated pods spin up.
import { getDb } from '@travelmanager/shared/db'
import { requireAdmin } from '../../../utils/admin.js'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const db = getDb()
  const { rows } = await db.query('SELECT provisioned_at FROM tenants WHERE id = $1', [id])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })

  return { id, status: rows[0].provisioned_at ? 'live' : 'provisioning' }
})
