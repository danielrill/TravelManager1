// POST /api/tenants/checkout { subdomain } — start the one-time setup payment for
// a self-serve standard workspace. Creates a Stripe Checkout Session bound to this
// caller+subdomain (client_reference_id), returns its URL for the SPA to redirect
// to. After payment the SPA calls /api/tenants/self-serve with the returned
// sessionId, which payments.js verifies server-side. Fails closed when no
// processor is configured.
import { validateSubdomain } from '../../utils/admin.js'
import { getPlan } from '@travelmanager/shared/tiers'

export default defineEventHandler(async (event) => {
  const ctx = event.context.user
  if (!ctx?.uid) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const b = await readBody(event)
  const subdomain = validateSubdomain(b.subdomain)
  const key = process.env.STRIPE_SECRET_KEY

  if (!key) {
    // Dev mock: no real session to create. The SPA sends { confirm: true } to
    // self-serve, which only succeeds when SELF_SERVE_ALLOW_MOCK=1.
    if (process.env.SELF_SERVE_ALLOW_MOCK === '1') {
      return { mock: true, sessionId: null }
    }
    throw createError({ statusCode: 503, statusMessage: 'Self-serve checkout is not available' })
  }

  const amount = getPlan('standard').oneTimeSetupCents || 0
  const rootDomain = process.env.ROOT_DOMAIN || 'onecloudaway.de'
  const base = `https://${subdomain}.${rootDomain}`

  const form = new URLSearchParams()
  form.set('mode', 'payment')
  form.set('client_reference_id', `${ctx.uid}:${subdomain}`)
  form.set('success_url', `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`)
  form.set('cancel_url', `${base}/?checkout=cancel`)
  form.set('line_items[0][quantity]', '1')
  form.set('line_items[0][price_data][currency]', 'eur')
  form.set('line_items[0][price_data][unit_amount]', String(amount))
  form.set('line_items[0][price_data][product_data][name]', `${subdomain} — Standard workspace setup`)

  let session
  try {
    session = await $fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `Checkout session failed: ${e?.data?.error?.message || e?.message || e}` })
  }

  return { sessionId: session.id, url: session.url }
})
