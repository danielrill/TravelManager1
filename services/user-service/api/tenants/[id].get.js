// GET /api/tenants/:id — PUBLIC white-label config only (SPA theming).
// Deliberately omits `plan` and `custom_domain` (commercially sensitive); the
// gateway reads the plan via the internal endpoint instead.
import { getDb } from '@travelmanager/shared/db'
import { cached } from '@travelmanager/shared/cache'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  // White-label config — rarely changes (busted on tenant upsert).
  const tenant = await cached(`tenant:${id}`, 3600, async () => {
    const db = getDb()
    const { rows } = await db.query(
      'SELECT id, name, logo_url, brand_color FROM tenants WHERE id = $1',
      [id]
    )
    return rows[0] ?? null
  })
  if (!tenant) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  return tenant
})
