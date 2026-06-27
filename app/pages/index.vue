<template>
  <div></div>
</template>

<script setup>
// Landing redirect. Membership-aware path comes from the shared useLanding()
// composable (admin host → /admin; standard-tenant non-member → /join access-code
// gate; member or free apex → /trips; logged out → /join|/register). Same logic the
// auth pages use, so there's no hardcoded /trips to ping-pong against.
const { authReady } = useAuth()
const landingPath = useLanding()

watch(authReady, async (ready) => { if (ready) navigateTo(await landingPath()) }, { immediate: true })
</script>
