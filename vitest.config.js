import { defineConfig } from 'vitest/config'

// Unit tests run in plain Node (no DOM) and exercise pure + mock-isolated logic
// only — no real DB, Redis, Pub/Sub, or network. Modules under test import
// workspace packages (@travelmanager/shared/*) via npm-workspace symlinks and
// service utils via relative paths; both resolve after a root `npm install`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // Measure only the logic these unit tests target. Nitro route handlers,
      // schema/seed DDL, and infra singletons (db/firebase/pubsub) need a live
      // backend and are out of scope for unit coverage.
      include: [
        'packages/shared/tiers.js',
        'packages/shared/identity.js',
        'packages/shared/geocode.js',
        'packages/shared/embed.js',
        'packages/shared/cache.js',
        'packages/shared/schema-bootstrap.js',
        'packages/shared/tenant-db.js',
        'services/api-gateway/utils/routing.js',
        'services/api-gateway/utils/tenant-host.js',
        'services/api-gateway/utils/ratelimit.js',
        'services/trip-service/utils/embedding.js',
        'services/trip-service/utils/recommend.js',
        'services/social-service/utils/feed.js',
        'services/notification-service/utils/notify.js',
      ],
    },
  },
})
