// PUT /api/admin/rate-cards/:plan — set/replace a plan's rate-card lines. Inserts
// a NEW effective_from row per dimension (versioned), so historical invoices keep
// the rate they were billed at. Policy: a change takes effect at the start of the
// next period (effective_from defaults to NOW(); loadPlanCard picks the latest
// row <= now, and finalised invoices are frozen — see period-rollup).
// Body: { lines: { [dimension]: { includedQty, unitRateCents, baseFeeCents } } }.
import { getDb } from '@travelmanager/shared/db'
import { DIMENSIONS, isDimension } from '@travelmanager/shared/rating'
import { PLANS } from '@travelmanager/shared/tiers'
import { requireAdmin } from '../../../utils/admin.js'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const plan = getRouterParam(event, 'plan')
  if (!PLANS[plan] || plan === 'free') {
    throw createError({ statusCode: 400, statusMessage: 'plan must be standard or enterprise' })
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
      `INSERT INTO rate_cards (plan, dimension, included_qty, unit_rate_cents, base_fee_cents)
       VALUES ($1,$2,$3,$4,$5)`,
      [plan, d, Number(l.includedQty) || 0, Number(l.unitRateCents) || 0, Number(l.baseFeeCents) || 0],
    )
  }
  return { ok: true, plan, updated: dims }
})
