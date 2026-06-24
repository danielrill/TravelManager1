// PUT /api/admin/rate-cards/overrides/:tenantId — set per-tenant negotiated rates
// (enterprise). Each override line layers on top of the plan card: a null field
// inherits the plan value. Versioned by effective_from like the plan cards.
// Body: { lines: { [dimension]: { includedQty?, unitRateCents? } } }.
import { getDb } from '@travelmanager/shared/db'
import { DIMENSIONS, isDimension } from '@travelmanager/shared/rating'
import { requireAdmin } from '../../../../utils/admin.js'

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const tenantId = getRouterParam(event, 'tenantId')
  if (!ID_RE.test(tenantId || '')) {
    throw createError({ statusCode: 400, statusMessage: 'bad tenant id' })
  }
  const body = await readBody(event)
  const lines = body?.lines || {}
  const dims = Object.keys(lines)
  if (!dims.length) throw createError({ statusCode: 400, statusMessage: 'lines required' })
  for (const d of dims) {
    if (!isDimension(d)) {
      throw createError({ statusCode: 400, statusMessage: `unknown dimension "${d}" (valid: ${DIMENSIONS.join(', ')})` })
    }
  }

  const db = getDb()
  for (const d of dims) {
    const l = lines[d] || {}
    await db.query(
      `INSERT INTO tenant_rate_overrides (tenant_id, dimension, included_qty, unit_rate_cents)
       VALUES ($1,$2,$3,$4)`,
      [
        tenantId,
        d,
        l.includedQty != null ? Number(l.includedQty) : null,
        l.unitRateCents != null ? Number(l.unitRateCents) : null,
      ],
    )
  }
  return { ok: true, tenantId, updated: dims }
})
