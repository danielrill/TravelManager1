// Self-serve onboarding payment — MOCKED by design. This product takes no real
// card payment: the SPA shows a confirmation step and posts { confirm: true }. We
// still verify the flag server-side (never trust an absent/forged body) and keep
// the payment seam in ONE place, so a real processor can drop in here later
// without touching the route.
class PaymentError extends Error {
  constructor(message, statusCode = 402) {
    super(message)
    this.statusCode = statusCode
  }
}

// Throws PaymentError (with .statusCode) when unconfirmed; returns a receipt on success.
export async function verifyOnboardingPayment(body) {
  if (!body?.confirm) throw new PaymentError('Payment confirmation required')
  return { provider: 'mock' }
}

export { PaymentError }
