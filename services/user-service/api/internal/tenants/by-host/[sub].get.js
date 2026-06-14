// GET /api/internal/tenants/by-host/:sub — resolve a tenant by its subdomain.
// Internal only (gateway blocks /api/internal publicly). The gateway calls this
// to map a request's Host (e.g. tui.onecloudaway.de → 'tui') to a tenant, then
// caches the result in Redis. Returns 404 for an unknown subdomain so the gateway
// can reject traffic to a subdomain that was never provisioned.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const sub = getRouterParam(event, 'sub')
  const db = getDb()
  const { rows } = await db.query(
    `SELECT id, name, plan, logo_url, brand_color, subdomain, rate_limit_per_min, provisioned_at
     FROM tenants WHERE subdomain = $1`,
    [sub]
  )
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  return rows[0]
})
