import { describe, it, expect, beforeEach } from 'vitest'
import { identityMiddleware, requireUser } from '@travelmanager/shared/identity'

const evt = (headers = {}, context = {}) => ({ node: { req: { headers } }, context })

describe('identity.requireUser', () => {
  it('returns the user when present on context', () => {
    const user = { uid: 'u1', plan: 'free' }
    expect(requireUser(evt({}, { user }))).toBe(user)
  })

  it('throws 401 when no authenticated user', () => {
    let err
    try { requireUser(evt({}, {})) } catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.statusCode).toBe(401)
  })

  it('throws 401 when user has no uid', () => {
    expect(() => requireUser(evt({}, { user: { plan: 'free' } }))).toThrow()
  })
})

describe('identity.identityMiddleware', () => {
  const saved = { ...process.env }
  beforeEach(() => { process.env = { ...saved }; delete process.env.DEV_USER_UID })

  it('populates context.user from gateway headers', () => {
    const event = evt({ 'x-user-uid': 'u1', 'x-plan': 'standard' })
    identityMiddleware(event)
    expect(event.context.user).toMatchObject({ uid: 'u1', plan: 'standard' })
  })

  it('injects a dev identity from DEV_USER_UID when no headers', () => {
    process.env.DEV_USER_UID = 'dev-1'
    const event = evt({})
    identityMiddleware(event)
    expect(event.context.user).toMatchObject({ uid: 'dev-1', plan: 'enterprise' })
  })

  it('leaves context.user unset when no headers and no DEV_USER_UID', () => {
    const event = evt({})
    identityMiddleware(event)
    expect(event.context.user).toBeUndefined()
  })

  it('prefers real headers over the dev fallback', () => {
    process.env.DEV_USER_UID = 'dev-1'
    const event = evt({ 'x-user-uid': 'real' })
    identityMiddleware(event)
    expect(event.context.user.uid).toBe('real')
  })
})
