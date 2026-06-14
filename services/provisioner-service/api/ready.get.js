// Readiness probe. The provisioner has no schema bootstrap of its own, so it is
// ready as soon as the process is up.
export default defineEventHandler(() => ({ status: 'ok', service: 'provisioner-service' }))
