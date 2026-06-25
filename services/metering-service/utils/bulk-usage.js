// Pure shaping for the bulk billing overview: merge each tenant's roster row
// (name/subdomain) onto its cost projection and sum the grand total. Kept free of
// h3/DB imports so it can be unit-tested directly.
export function shapeBulk(tenants, projections, billingPeriod) {
  const byId = new Map(projections.map((p) => [p.tenantId, p]))
  const rows = tenants.map((t) => {
    const p = byId.get(t.id) || { totalCents: 0, lines: [], usage: {} }
    return {
      tenantId: t.id,
      subdomain: t.subdomain ?? null,
      name: t.name,
      plan: t.plan,
      totalCents: p.totalCents,
      lines: p.lines,
      usage: p.usage,
    }
  })
  const totalCents = rows.reduce((sum, r) => sum + (r.totalCents || 0), 0)
  return { billingPeriod, totalCents, tenants: rows }
}
