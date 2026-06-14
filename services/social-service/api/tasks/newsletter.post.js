// POST /api/tasks/newsletter — weekly CronJob. For every user, fetches
// personalized trip recommendations (semantic, from what they liked + created)
// and publishes a NewsletterReady event per user for the Notification service to
// deliver. Recommendations are computed by the Trip service (it owns trips +
// embeddings + the likes lookup); this job is the orchestrator.
//
// Runs once per tenant: each tenant's users + trips live in that tenant's pod, so
// we scope the user list and forward the tenant to the recommendation lookup.
import { forEachTenant } from '@travelmanager/shared/tenant-db'
import { publishEvent } from '@travelmanager/shared/pubsub'
import { control } from '../../utils/control.js'

const RECS_PER_USER = 5
const CONCURRENCY = 10

async function newsletterForTenant(db, tenantId) {
  const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
  const tripServiceUrl = process.env.TRIP_SERVICE_URL || 'http://localhost:3002'

  // Page through this tenant's users (Social owns the follow graph, not the user
  // list). tenant filter keeps a tenant's newsletter to its own members.
  const uids = []
  for (let offset = 0; ; offset += 500) {
    const page = await $fetch('/api/internal/users', {
      baseURL: userServiceUrl,
      query: { limit: 500, offset, tenant: tenantId },
    }).catch((e) => { console.error('[social] list users failed', e?.message || e); return [] })
    uids.push(...page)
    if (page.length < 500) break
  }

  let notified = 0
  for (let i = 0; i < uids.length; i += CONCURRENCY) {
    const batch = uids.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (uid) => {
      const recs = await $fetch('/api/internal/recommended', {
        baseURL: tripServiceUrl,
        headers: { 'x-tenant-id': tenantId }, // read trips from the tenant's pod
        query: { uid, limit: RECS_PER_USER },
      }).catch((e) => { console.error('[social] recommended failed for', uid, e?.message || e); return [] })

      if (!recs.length) return // nothing to recommend — skip this user.

      const recommendations = recs.map(r => ({
        id: r.id,
        title: r.title,
        destination: r.destination,
        shortDescription: r.short_description,
        author: r.author_name,
        reason: r.reason,
      }))

      await db.query(
        'INSERT INTO newsletter_log (user_uid, entry_count) VALUES ($1, $2)',
        [uid, recommendations.length]
      )
      await publishEvent('NewsletterReady', {
        userUid: uid,
        tenantId,
        entryCount: recommendations.length,
        recommendations,
      }).catch((e) => console.error('[social] publish NewsletterReady failed', e))
      notified++
    }))
  }

  return { usersScanned: uids.length, usersNotified: notified }
}

export default defineEventHandler(async () => {
  const perTenant = await forEachTenant((db, tenantId) => newsletterForTenant(db, tenantId))
  const usersScanned = perTenant.reduce((n, t) => n + (t.result?.usersScanned || 0), 0)
  const notified = perTenant.reduce((n, t) => n + (t.result?.usersNotified || 0), 0)

  control.newsletter.lastRun = new Date().toISOString()
  control.newsletter.usersNotified += notified
  return { ok: true, tenants: perTenant.length, usersScanned, usersNotified: notified }
})
