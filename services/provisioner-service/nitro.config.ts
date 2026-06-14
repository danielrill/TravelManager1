// Standalone Nitro app — Provisioner Service. Holds the k8s ServiceAccount/RBAC
// to create per-tenant Postgres pods and orchestrates schema bootstrap. Internal
// only (gateway-blocked); called by the user-service admin flow.
export default defineNitroConfig({
  srcDir: '.',
  preset: 'node-server',
  compatibilityDate: '2025-05-01',
  imports: {
    dirs: ['utils'],
  },
  runtimeConfig: {
    serviceName: 'provisioner-service',
  },
})
