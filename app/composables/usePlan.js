// Plan-aware feature gating for the SPA. The gateway resolves the caller's plan
// from their tenant and forwards it as `x-plan`; /api/users/me surfaces it onto
// user.value.plan. This composable reads that and answers "can the current user
// use feature X?" using the SAME plan matrix the gateway enforces — so the UI can
// gate proactively (hide / show an upgrade prompt) instead of only reacting to a
// 403. Server stays the source of truth; this is purely cosmetic pre-gating.
import { getPlan, planAllows, PLANS } from '@travelmanager/shared/tiers'

export const usePlan = () => {
  const { user } = useAuth()

  const planId = computed(() => user.value?.plan || 'free')
  const plan = computed(() => getPlan(planId.value))
  const planLabel = computed(() => plan.value.label)

  // can('feed' | 'newsletter' | 'whiteLabel' | 'b2bData')
  const can = (feature) => planAllows(planId.value, feature)

  // Cheapest plan that unlocks `feature` — for "Upgrade to X" copy.
  const requiredPlanFor = (feature) => {
    const tier = Object.values(PLANS).find((p) => p.features[feature])
    return tier?.label || 'a higher'
  }

  return { planId, plan, planLabel, can, requiredPlanFor, PLANS }
}
