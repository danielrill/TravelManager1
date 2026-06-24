// DELETE /api/admin/tenants/:id — offboard a standard tenant: tear down its
// Postgres pod + PVC (via the provisioner), move its members back to the free
// 'default' tenant, and remove the tenant row. The tenant's trips/feed data lives
// only in that pod's volume and is destroyed with it. Cannot delete 'default'.
import { getDb } from '@travelmanager/shared/db'
import { invalidate } from '@travelmanager/shared/cache'
import { requireAdmin } from '../../../utils/admin.js'
import { traceHeaders } from '@travelmanager/shared/trace'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (id === 'default') {
    throw createError({ statusCode: 400, statusMessage: 'The free tenant cannot be deleted' })
  }

  const db = getDb()
  const { rows } = await db.query('SELECT id, subdomain FROM tenants WHERE id = $1', [id])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })
  const sub = rows[0].subdomain

  // 1. Tear down the dedicated Postgres pod + PVC + Service + NetworkPolicy.
  const provUrl = process.env.PROVISIONER_SERVICE_URL || 'http://localhost:3006'
  try {
    await $fetch('/api/internal/deprovision-tenant', { method: 'POST', baseURL: provUrl, headers: { ...traceHeaders(event) }, body: { tenantId: id } })
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `Pod teardown failed: ${e?.data?.statusMessage || e?.message || e}` })
  }

  // 2. Move members back to the free tenant so they aren't orphaned.
  await db.query(`UPDATE users SET tenant_id = 'default' WHERE tenant_id = $1`, [id])

  // 3. Remove the tenant row + bust the gateway's host→tenant cache.
  await db.query('DELETE FROM tenants WHERE id = $1', [id])
  invalidate(`tenant:${id}`)
  if (sub) invalidate(`tenanthost:${sub}`)

  return { ok: true, deleted: id }
})
