// GET /api/tenants/current — public. Returns the tenant of the CURRENT host
// (the gateway resolves it from the subdomain and injects x-tenant-id). Lets the
// SPA know which workspace it's on and whether an access code is required, without
// parsing domains client-side. Never returns the signup_code.
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const id = event.context.tenantId || 'default'
  const db = getDb()
  const { rows } = await db.query(
    `SELECT id, name, plan, subdomain, logo_url, brand_color,
            (signup_code IS NOT NULL) AS requires_code, (provisioned_at IS NOT NULL) AS provisioned
     FROM tenants WHERE id = $1`,
    [id]
  )
  if (!rows.length) return { id: 'default', name: 'TravelManager', requires_code: false }
  return rows[0]
})
