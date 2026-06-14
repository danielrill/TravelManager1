// POST /api/internal/backfill-geocode — one-off maintenance: geocode trips that
// predate the dest_lat/dest_lng/dest_country columns so existing trips get
// pinned on the map and matched against country travel warnings. Internal; not
// routed through the public gateway. Idempotent — only touches rows missing a
// country, safe to re-run. Runs once per tenant (shared + each tenant pod).
import { forEachTenant } from '@travelmanager/shared/tenant-db'
import { geocodeCity } from '@travelmanager/shared/geocode'

async function geocodeOne(db) {
  const { rows } = await db.query(
    `SELECT id, destination FROM trips WHERE dest_country IS NULL`
  )

  let updated = 0
  for (const t of rows) {
    const geo = await geocodeCity(t.destination)
    if (!geo) continue
    await db.query(
      `UPDATE trips SET dest_lat = COALESCE(dest_lat, $1),
                        dest_lng = COALESCE(dest_lng, $2),
                        dest_country = $3
       WHERE id = $4`,
      [geo.lat ?? null, geo.lng ?? null, geo.country ?? null, t.id]
    )
    if (geo.country) updated++
  }

  return { scanned: rows.length, updated }
}

export default defineEventHandler(async () => {
  const perTenant = await forEachTenant((db) => geocodeOne(db))
  const scanned = perTenant.reduce((n, t) => n + (t.result?.scanned || 0), 0)
  const updated = perTenant.reduce((n, t) => n + (t.result?.updated || 0), 0)
  return { ok: true, tenants: perTenant.length, scanned, updated }
})
