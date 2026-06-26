// SaaS B2B plan definitions. The API Gateway enforces rate limits and feature
// gating from this single source of truth; the frontend reads white-label config
// per tenant. Plans: Free / Standard / Enterprise.
export const PLANS = {
  free: {
    id: 'free',
    label: 'Free',
    rateLimitPerMin: 60,
    features: {
      feed: false,
      newsletter: false,
      whiteLabel: false,
      b2bData: false,
    },
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    // One-time onboarding charge (€29.99, in cents). After this there is NO recurring
    // subscription fee — ongoing billing is 100% usage-based (the metering rate card
    // carries base_fee_cents: 0 on every dimension). The free→standard self-serve
    // checkout collects this once.
    oneTimeSetupCents: 2999,
    rateLimitPerMin: 600,
    features: {
      feed: true,
      newsletter: true,
      whiteLabel: true,
      b2bData: false,
    },
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    rateLimitPerMin: 6000,
    features: {
      feed: true,
      newsletter: true,
      whiteLabel: true,
      b2bData: true,
    },
  },
}

export function getPlan(planId) {
  return PLANS[planId] || PLANS.free
}

export function planAllows(planId, feature) {
  return Boolean(getPlan(planId).features[feature])
}
