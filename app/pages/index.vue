<template>
  <div></div>
</template>

<script setup>
// Landing redirect. On a standard tenant subdomain a non-member is sent to the
// access-code gate (/join) FIRST — login happens once, after the code. The free
// apex keeps the normal login → app flow.
const { user, authReady } = useAuth()
const tenant = useState('currentTenant', () => undefined)

async function route() {
  if (tenant.value === undefined) {
    try { tenant.value = await useApiFetch().apiFetch('/api/tenants/current') } catch { tenant.value = null }
  }
  const standard = tenant.value && tenant.value.id !== 'default'

  if (!user.value) {
    return navigateTo(standard ? '/join' : '/register')
  }
  if (standard && user.value.tenant_id !== tenant.value.id) {
    return navigateTo('/join')
  }
  return navigateTo('/trips')
}

watch(authReady, (ready) => { if (ready) route() }, { immediate: true })
</script>
