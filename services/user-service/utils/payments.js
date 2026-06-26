// Self-serve onboarding payment verification. The free→standard upgrade carries a
// one-time setup charge (PLANS.standard.oneTimeSetupCents). The browser must NOT
// be trusted to assert payment — a raw boolean `confirm` let any authenticated
// user mint a standard workspace (dedicated Postgres pod + app pods) for free. So
// payment is verified server-side against the processor, and the check FAILS
// CLOSED: if no processor is configured we refuse rather than provision.
//
//   - STRIPE_SECRET_KEY set  → verify a Stripe Checkout Session is actually paid,
//     bound to this caller+subdomain, for at least the setup amount.
//   - SELF_SERVE_ALLOW_MOCK=1 → dev/test escape hatch: accept the legacy boolean.
//     MUST stay unset in prod (the Helm values do not set it).
//   - neither                → reject (no way to take money ⇒ no provisioning).
import { getPlan } from '@travelmanager/shared/tiers'

class PaymentError extends Error {
  constructor(message, statusCode = 402) {
    super(message)
    this.statusCode = statusCode
  }
}

async function verifyStripeSession(sessionId, { uid, subdomain, plan }) {
  if (!sessionId) throw new PaymentError('paymentSessionId required')
  const key = process.env.STRIPE_SECRET_KEY
  let session
  try {
    session = await $fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch (e) {
    // 404 / bad id / network — treat as unpaid, never as authorised.
    throw new PaymentError(`payment session lookup failed: ${e?.data?.error?.message || e?.message || e}`)
  }
  if (session.payment_status !== 'paid') {
    throw new PaymentError(`payment not completed (status: ${session.payment_status})`)
  }
  // Bind the session to THIS request so a paid session can't be replayed for a
  // different workspace or by a different user. checkout.post.js stamps these.
  if (session.client_reference_id !== `${uid}:${subdomain}`) {
    throw new PaymentError('payment session does not match this user/workspace', 403)
  }
  const required = getPlan(plan).oneTimeSetupCents || 0
  if (Number(session.amount_total || 0) < required) {
    throw new PaymentError(`payment amount ${session.amount_total} below required ${required}`)
  }
  return { provider: 'stripe', sessionId, amountCents: session.amount_total }
}

// Throws PaymentError (with .statusCode) on any failure; returns a receipt on success.
export async function verifyOnboardingPayment(body, { uid, subdomain, plan }) {
  if (process.env.STRIPE_SECRET_KEY) {
    return verifyStripeSession(body.paymentSessionId, { uid, subdomain, plan })
  }
  if (process.env.SELF_SERVE_ALLOW_MOCK === '1') {
    if (!body.confirm) throw new PaymentError('Payment confirmation required')
    return { provider: 'mock', amountCents: getPlan(plan).oneTimeSetupCents || 0 }
  }
  // No processor wired and no explicit dev override → refuse. Better to block
  // self-serve than to hand out paid infrastructure unpaid.
  throw new PaymentError('Self-serve checkout is not available (no payment processor configured)', 503)
}

export { PaymentError }
