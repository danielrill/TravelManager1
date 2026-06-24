// Metering Service. Consumes UsageRecorded events, aggregates per-tenant usage
// into Postgres, owns rate cards + invoices, and serves tenant/admin billing APIs.
//
// Billing data is control-plane: it lives on the SHARED DB (getDb) keyed by
// tenant_id, NOT on per-tenant pods. The operator must bill across all tenants
// from one place, and this service is a shared singleton (not provisioned per
// tenant), so centralising avoids cross-pod fan-out and per-pod schema bootstrap.
export default defineNitroConfig({
  srcDir: '.',
  preset: 'node-server',
  compatibilityDate: '2025-05-01',
  imports: {
    dirs: ['utils'],
  },
  runtimeConfig: {
    serviceName: 'metering-service',
    userServiceUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    usageSub: process.env.USAGE_SUB || 'metering-usage-sub',
  },
})
