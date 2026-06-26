export default defineNuxtConfig({
  srcDir: 'app/',
  compatibilityDate: '2024-11-01',
  devtools: { enabled: false },

  // Client-only SPA. Auth (Firebase), tenant resolution and all data are
  // client-fetched, so SSR added no value and actively hurt: the server rendered
  // the app (login page) before the client-only tenant plugin could resolve the
  // host, producing a register→not-found flash + hydration mismatches on unknown
  // subdomains. Rendering purely on the client lets the tenant gate decide before
  // first paint.
  ssr: false,

  // Pull the shared plan matrix (@travelmanager/shared/tiers) into the client
  // bundle. It's a workspace-symlinked package, so transpile it rather than treat
  // it as an external. Only the pure /tiers subpath is imported (no pg/firebase).
  build: { transpile: ['@travelmanager/shared'] },

  // Pure frontend now: the old monolith server/ lives on the IAAS/paas branches.
  // All /api traffic is routed to the API Gateway by the ingress (prod) or nginx
  // (local). apiBase lets the SPA target a different gateway origin if needed.
  runtimeConfig: {
    public: {
      apiBase:       process.env.NUXT_PUBLIC_API_BASE ?? '',
      googleMapsKey: process.env.NUXT_PUBLIC_GOOGLE_MAPS_KEY ?? '',
      firebase: {
        apiKey:            process.env.NUXT_PUBLIC_FIREBASE_API_KEY          ?? '',
        authDomain:        process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN      ?? '',
        projectId:         process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID       ?? '',
        appId:             process.env.NUXT_PUBLIC_FIREBASE_APP_ID           ?? '',
        storageBucket:     process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET   ?? '',
      },
    },
  },

  vite: {
    build: {
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three') || id.includes('node_modules/globe.gl')) {
              return 'vendor-globe'
            }
          },
        },
      },
    },
  },
  nitro: {
    preset: "node-server"
  }
})
