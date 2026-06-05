<!-- Plan upgrade prompt. Shown in place of a feature the current plan can't use,
     so users see *why* it's locked instead of an empty page or a raw 403. Pure
     UI — the gateway still enforces the real gate. -->
<template>
  <div class="upgrade-prompt">
    <div class="upgrade-icon">{{ icon }}</div>
    <h3 class="upgrade-title">{{ title }}</h3>
    <p class="upgrade-body">
      <slot>
        This feature is available on the <strong>{{ requiredPlan }}</strong> plan and above.
        You're currently on <strong>{{ planLabel }}</strong>.
      </slot>
    </p>
    <NuxtLink to="/profile" class="btn btn-gold upgrade-cta">View plans →</NuxtLink>
  </div>
</template>

<script setup>
const props = defineProps({
  feature: { type: String, required: true },
  icon:    { type: String, default: '🔒' },
  title:   { type: String, default: 'Upgrade to unlock' },
})

const { planLabel, requiredPlanFor } = usePlan()
const requiredPlan = computed(() => requiredPlanFor(props.feature))
</script>

<style scoped>
.upgrade-prompt {
  background: var(--white);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  border-top: 3px solid var(--gold);
  padding: 48px 32px;
  text-align: center;
  max-width: 480px;
  margin: 32px auto;
}
.upgrade-icon { font-size: 2.6rem; margin-bottom: 8px; }
.upgrade-title {
  font-family: 'Playfair Display', serif;
  font-size: 1.4rem; color: var(--navy); margin-bottom: 10px;
}
.upgrade-body { color: var(--text-muted); font-size: 0.92rem; line-height: 1.6; margin-bottom: 20px; }
.upgrade-cta { margin-top: 4px; }
</style>
