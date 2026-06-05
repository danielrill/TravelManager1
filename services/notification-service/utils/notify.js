// Notification delivery. Resolves the recipient's email from the User service,
// then sends via the Resend REST API ($fetch — no SDK dependency). If no
// RESEND_API_KEY is configured the email is logged instead (dev / CI safe).
//
// Sends are serialized through a min-gap gate + retried with backoff on HTTP 429
// because Resend rate-limits (default 2 req/s) and the Pub/Sub subscriber
// delivers messages concurrently.
import { getDb } from '@travelmanager/shared/db'
import { control } from './control.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Per-pod send gate: never fire two requests closer than EMAIL_MIN_GAP_MS apart.
// 1100ms/pod → ~0.9 sends/s per pod; with 2 replicas that's ~1.8/s, under
// Resend's default 2/s. Backoff below catches any residual 429.
const MIN_GAP_MS = Number(process.env.EMAIL_MIN_GAP_MS || 1100)
const MAX_RETRIES = Number(process.env.EMAIL_MAX_RETRIES || 5)
let _gate = Promise.resolve()
let _lastSentAt = 0
function gate() {
  _gate = _gate.then(async () => {
    const wait = _lastSentAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    _lastSentAt = Date.now()
  })
  return _gate
}

async function resolveEmail(userUid) {
  // Runtime env read (useRuntimeConfig bakes defaults at build time).
  const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3001'
  try {
    const u = await $fetch(`/api/users/${userUid}`, { baseURL: userServiceUrl })
    return u?.email || null
  } catch {
    return null
  }
}

// html is optional; when present Resend uses it as the rich body (text stays as
// the plain-text fallback for clients that don't render HTML).
async function sendEmail(to, subject, text, html) {
  const resendApiKey = process.env.RESEND_API_KEY || ''
  const fromEmail = process.env.FROM_EMAIL || 'alerts@travelmanager.app'
  if (!resendApiKey) {
    console.log(`[notify] (no Resend key) would email ${to}: ${subject}`)
    return false
  }
  for (let attempt = 0; ; attempt++) {
    await gate()
    try {
      await $fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}` },
        body: { from: fromEmail, to: [to], subject, text, ...(html ? { html } : {}) },
      })
      return true
    } catch (e) {
      // 429 = Resend rate limit. Honor Retry-After if present, else back off
      // exponentially, and retry up to MAX_RETRIES before giving up.
      if (e?.response?.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(e.response.headers?.get?.('retry-after')) || 0
        await sleep(retryAfter ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 8000))
        continue
      }
      throw e
    }
  }
}

async function logNotification(userUid, kind, subject, delivered) {
  const db = getDb()
  await db.query(
    'INSERT INTO notification_log (user_uid, kind, subject, delivered) VALUES ($1,$2,$3,$4)',
    [userUid, kind, subject, delivered]
  ).catch((e) => console.error('[notify] log failed', e))
}

export async function handleTravelAlert(payload) {
  control.alert.processed++
  control.alert.lastMessageAt = new Date().toISOString()
  const email = await resolveEmail(payload.userUid)
  const subject = `Travel alert for ${payload.country}: ${payload.severity}`
  const text = `Heads up — there is an active travel ${payload.severity} for ${payload.country}, ` +
    `which affects your trip "${payload.tripTitle}". Details: ${payload.title}.`
  let delivered = false
  if (email) {
    try { delivered = await sendEmail(email, subject, text) }
    catch (e) { control.alert.errors++; console.error('[notify] alert email failed', e) }
  }
  if (delivered) control.alert.sent++
  await logNotification(payload.userUid, 'alert', subject, delivered)
}

// Escape user-supplied strings before inlining into HTML (trip titles etc).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// Build the responsive, inline-styled HTML newsletter. Each trip is a clickable
// card linking to its detail page on the site.
function newsletterHtml(recs, baseUrl) {
  const cards = recs.map((r) => {
    const url = `${baseUrl}/trips/${encodeURIComponent(r.id)}`
    return `
      <tr><td style="padding:0 0 16px;">
        <a href="${url}" style="display:block;text-decoration:none;color:inherit;border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#ffffff;">
          <div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#2563eb;margin:0 0 6px;">${esc(r.destination)}</div>
          <div style="font-size:18px;font-weight:700;color:#111827;margin:0 0 6px;">${esc(r.title)}</div>
          ${r.shortDescription ? `<div style="font-size:14px;line-height:1.5;color:#4b5563;margin:0 0 12px;">${esc(r.shortDescription)}</div>` : ''}
          <div style="font-size:13px;color:#6b7280;margin:0 0 14px;">by ${esc(r.author)}</div>
          <span style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;padding:9px 16px;border-radius:8px;">View trip →</span>
        </a>
      </td></tr>`
  }).join('')

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr><td style="padding:0 4px 20px;">
            <div style="font-size:22px;font-weight:800;color:#111827;">Trips picked for you</div>
            <div style="font-size:14px;color:#6b7280;margin-top:4px;">Based on the trips you've liked and created — here's where to go next.</div>
          </td></tr>
          ${cards}
          <tr><td style="padding:8px 4px 0;">
            <div style="font-size:12px;color:#9ca3af;">You're receiving this because you have a TravelManager account.
            <a href="${baseUrl}" style="color:#6b7280;">Open TravelManager</a></div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`
}

export async function handleNewsletter(payload) {
  control.newsletter.processed++
  control.newsletter.lastMessageAt = new Date().toISOString()
  const email = await resolveEmail(payload.userUid)
  const recs = payload.recommendations || []
  const baseUrl = (process.env.APP_BASE_URL || 'https://onecloudaway.de').replace(/\/$/, '')
  const subject = `Trips picked for you — ${recs.length} ${recs.length === 1 ? 'idea' : 'ideas'}`
  const lines = recs.map(r => `• ${r.title} (${r.destination}) by ${r.author} — ${baseUrl}/trips/${r.id}`)
  const text = `Based on the trips you've liked and created, here's where to go next:\n\n${lines.join('\n')}`
  const html = newsletterHtml(recs, baseUrl)
  let delivered = false
  if (email) {
    try { delivered = await sendEmail(email, subject, text, html) }
    catch (e) { control.newsletter.errors++; console.error('[notify] newsletter email failed', e) }
  }
  if (delivered) control.newsletter.sent++
  await logNotification(payload.userUid, 'newsletter', subject, delivered)
}
