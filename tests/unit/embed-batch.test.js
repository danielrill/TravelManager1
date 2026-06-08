import { describe, it, expect, vi, afterEach } from 'vitest'

// embedBatch FAILS OPEN — the contract that keeps dev/CI green without GCP creds.
const savedEnv = { ...process.env }

async function load(env = {}) {
  // Reload so the module's _auth/_disabled singletons reset per scenario.
  vi.resetModules()
  process.env = { ...savedEnv }
  delete process.env.GOOGLE_CLOUD_PROJECT
  delete process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID
  delete process.env.VERTEX_DISABLED
  Object.assign(process.env, env)
  return import('@travelmanager/shared/embed')
}

afterEach(() => { process.env = { ...savedEnv } })

describe('embed.embedBatch (fail-open contract)', () => {
  it('returns [] for empty input without touching auth', async () => {
    const { embedBatch } = await load({ GOOGLE_CLOUD_PROJECT: 'p' })
    expect(await embedBatch([])).toEqual([])
  })

  it('returns aligned nulls when Vertex is explicitly disabled', async () => {
    const { embedBatch } = await load({ GOOGLE_CLOUD_PROJECT: 'p', VERTEX_DISABLED: '1' })
    expect(await embedBatch(['a', 'b', 'c'])).toEqual([null, null, null])
  })

  it('returns aligned nulls when no GCP project is configured', async () => {
    const { embedBatch } = await load()
    expect(await embedBatch(['a', 'b'])).toEqual([null, null])
  })

  it('coerces nullish entries to strings before counting', async () => {
    const { embedBatch } = await load({ VERTEX_DISABLED: '1', GOOGLE_CLOUD_PROJECT: 'p' })
    expect(await embedBatch([null, undefined, 'x'])).toEqual([null, null, null])
  })
})

describe('embed.embed (fail-open contract)', () => {
  it('returns null when disabled', async () => {
    const { embed } = await load({ VERTEX_DISABLED: '1', GOOGLE_CLOUD_PROJECT: 'p' })
    expect(await embed('hello')).toBeNull()
  })

  it('returns null when no project is configured', async () => {
    const { embed } = await load()
    expect(await embed('hello')).toBeNull()
  })
})
