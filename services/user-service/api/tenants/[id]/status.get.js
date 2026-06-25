// GET /api/tenants/:id/status — self-serve provisioning progress for the
// authenticated caller. Uncached (provisioned_at flips mid-provision) and returns
// only live|provisioning, so the SPA can safely poll it while the dedicated pods
// spin up (a job that outlives any proxy's request timeout).
import { getDb } from '@travelmanager/shared/db'

export default defineEventHandler(async (event) => {
  const ctx = event.context.user
  if (!ctx?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const id = getRouterParam(event, 'id')
  const db = getDb()
  const { rows } = await db.query('SELECT provisioned_at FROM tenants WHERE id = $1', [id])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Tenant not found' })

  const rootDomain = process.env.ROOT_DOMAIN || 'onecloudaway.de'
  return {
    id,
    status: rows[0].provisioned_at ? 'live' : 'provisioning',
    url: `https://${id}.${rootDomain}`,
  }
})
