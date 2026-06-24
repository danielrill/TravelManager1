// GET /api/admin/rate-cards — operator view of the live price book (latest
// effective rows per plan/dimension) plus all per-tenant overrides.
import { getDb } from '@travelmanager/shared/db'
import { requireAdmin } from '../../../utils/admin.js'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getDb()
  const { rows: cards } = await db.query(
    `SELECT DISTINCT ON (plan, dimension) plan, dimension, included_qty, unit_rate_cents, base_fee_cents, effective_from
       FROM rate_cards
      WHERE effective_from <= NOW()
      ORDER BY plan, dimension, effective_from DESC`,
  )
  const { rows: overrides } = await db.query(
    `SELECT DISTINCT ON (tenant_id, dimension) tenant_id, dimension, included_qty, unit_rate_cents, effective_from
       FROM tenant_rate_overrides
      WHERE effective_from <= NOW()
      ORDER BY tenant_id, dimension, effective_from DESC`,
  )
  return { cards, overrides }
})
