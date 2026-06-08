import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// notify.js writes an audit row via getDb() and talks to the User service +
// Resend over the global $fetch. Mock the db and stub $fetch. Each test loads a
// fresh module so the in-module `control` counters + env-derived gate reset.
const { dbQuery } = vi.hoisted(() => ({ dbQuery: vi.fn() }))
vi.mock('@travelmanager/shared/db', () => ({ getDb: () => ({ query: dbQuery }) }))

const savedEnv = { ...process.env }
let fetchMock

async function loadNotify(env = {}) {
  vi.resetModules()
  Object.assign(process.env, env)
  const mod = await import('../../services/notification-service/utils/notify.js')
  // control lives in its own module; re-importing after notify pulled it in
  // returns the same fresh instance from the just-reset registry.
  const { control } = await import('../../services/notification-service/utils/control.js')
  return { ...mod, control }
}

beforeEach(() => {
  process.env = { ...savedEnv }
  delete process.env.RESEND_API_KEY
  dbQuery.mockReset().mockResolvedValue({})
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes('/api/users/')) return { email: 'traveler@example.com' }
    if (String(url) === 'https://api.resend.com/emails') return {}
    return {}
  })
  vi.stubGlobal('$fetch', fetchMock)
})
afterEach(() => { process.env = { ...savedEnv }; vi.unstubAllGlobals() })

describe('notify.handleTravelAlert', () => {
  it('logs as undelivered when no Resend key is configured (CI-safe)', async () => {
    const { handleTravelAlert, control } = await loadNotify()
    await handleTravelAlert({ userUid: 'u1', country: 'FR', severity: 'warning', tripTitle: 'Paris', title: 'Strike' })
    expect(control.alert.processed).toBe(1)
    expect(control.alert.sent).toBe(0)
    // audit row written with delivered=false (4th param)
    const args = dbQuery.mock.calls.at(-1)[1]
    expect(args[1]).toBe('alert')
    expect(args[3]).toBe(false)
  })

  it('sends and counts a delivery when a Resend key is set', async () => {
    const { handleTravelAlert, control } = await loadNotify({ RESEND_API_KEY: 're_test', EMAIL_MIN_GAP_MS: '0' })
    await handleTravelAlert({ userUid: 'u1', country: 'FR', severity: 'warning', tripTitle: 'Paris', title: 'Strike' })
    expect(control.alert.sent).toBe(1)
    // POSTed to Resend
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }))
    expect(dbQuery.mock.calls.at(-1)[1][3]).toBe(true)
  })

  it('skips sending when the recipient email cannot be resolved', async () => {
    fetchMock.mockImplementation(async () => ({})) // user lookup returns no email
    const { handleTravelAlert, control } = await loadNotify({ RESEND_API_KEY: 're_test', EMAIL_MIN_GAP_MS: '0' })
    await handleTravelAlert({ userUid: 'ghost', country: 'FR', severity: 'warning', tripTitle: 'P', title: 'X' })
    expect(control.alert.sent).toBe(0)
    expect(fetchMock).not.toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything())
  })

  it('treats a failing user lookup as unresolved email', async () => {
    fetchMock.mockRejectedValue(new Error('user service down'))
    const { handleTravelAlert, control } = await loadNotify({ RESEND_API_KEY: 're_test', EMAIL_MIN_GAP_MS: '0' })
    await handleTravelAlert({ userUid: 'ghost', country: 'FR', severity: 'warning', tripTitle: 'P', title: 'X' })
    expect(control.alert.sent).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('counts send errors and still writes an undelivered audit row', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/users/')) return { email: 'traveler@example.com' }
      if (String(url) === 'https://api.resend.com/emails') throw new Error('resend down')
      return {}
    })
    const { handleTravelAlert, control } = await loadNotify({ RESEND_API_KEY: 're_test', EMAIL_MIN_GAP_MS: '0' })
    await handleTravelAlert({ userUid: 'u1', country: 'FR', severity: 'warning', tripTitle: 'Paris', title: 'Strike' })
    expect(control.alert.errors).toBe(1)
    expect(control.alert.sent).toBe(0)
    expect(dbQuery.mock.calls.at(-1)[1][3]).toBe(false)
    errorSpy.mockRestore()
  })

  it('swallows audit-log failures after processing the alert', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    dbQuery.mockRejectedValue(new Error('db down'))
    const { handleTravelAlert, control } = await loadNotify()
    await expect(handleTravelAlert({ userUid: 'u1', country: 'FR', severity: 'warning', tripTitle: 'Paris', title: 'Strike' })).resolves.toBeUndefined()
    expect(control.alert.processed).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('[notify] log failed', expect.any(Error))
    errorSpy.mockRestore()
  })
})

describe('notify.handleNewsletter', () => {
  const payload = {
    userUid: 'u1',
    recommendations: [{ id: 't1', title: 'Alps', destination: 'Innsbruck', author: 'Bob' }],
  }

  it('processes and audits the newsletter (no key → undelivered)', async () => {
    const { handleNewsletter, control } = await loadNotify()
    await handleNewsletter(payload)
    expect(control.newsletter.processed).toBe(1)
    expect(control.newsletter.sent).toBe(0)
    expect(dbQuery.mock.calls.at(-1)[1][1]).toBe('newsletter')
  })

  it('sends an HTML newsletter when a key is set', async () => {
    const { handleNewsletter, control } = await loadNotify({ RESEND_API_KEY: 're_test', EMAIL_MIN_GAP_MS: '0' })
    await handleNewsletter(payload)
    expect(control.newsletter.sent).toBe(1)
    const body = fetchMock.mock.calls.find(c => c[0] === 'https://api.resend.com/emails')[1].body
    expect(body.html).toContain('/trips/t1')
    expect(body.subject).toMatch(/1 idea/)
  })

  it('counts newsletter send errors and leaves delivery false', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/users/')) return { email: 'traveler@example.com' }
      if (String(url) === 'https://api.resend.com/emails') throw new Error('resend down')
      return {}
    })
    const { handleNewsletter, control } = await loadNotify({ RESEND_API_KEY: 're_test', EMAIL_MIN_GAP_MS: '0' })
    await handleNewsletter(payload)
    expect(control.newsletter.errors).toBe(1)
    expect(control.newsletter.sent).toBe(0)
    expect(dbQuery.mock.calls.at(-1)[1][3]).toBe(false)
    errorSpy.mockRestore()
  })

  it('trims the app base URL before composing newsletter links', async () => {
    const { handleNewsletter } = await loadNotify({
      RESEND_API_KEY: 're_test',
      EMAIL_MIN_GAP_MS: '0',
      APP_BASE_URL: 'https://app.example.com/',
    })
    await handleNewsletter({
      userUid: 'u1',
      recommendations: [
        { id: 't1', title: 'Alps', destination: 'Innsbruck', author: 'Bob' },
        { id: 't2', title: 'Beach', destination: 'Nice', author: 'Ana' },
      ],
    })
    const body = fetchMock.mock.calls.find(c => c[0] === 'https://api.resend.com/emails')[1].body
    expect(body.subject).toMatch(/2 ideas/)
    expect(body.html).toContain('https://app.example.com/trips/t1')
    expect(body.html).not.toContain('https://app.example.com//trips')
  })
})
