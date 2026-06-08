import { describe, it, expect } from 'vitest'
import { readIdentity } from '@travelmanager/shared/identity'

// readIdentity parses the trusted identity headers the API Gateway injects into
// downstream requests. Build a minimal h3-style event with node.req.headers.
const evt = (headers) => ({ node: { req: { headers } } })

describe('identity.readIdentity', () => {
  it('returns null when x-user-uid is absent', () => {
    expect(readIdentity(evt({}))).toBeNull()
    expect(readIdentity(evt({ 'x-user-email': 'a@b.c' }))).toBeNull()
  })

  it('maps all gateway headers to the identity object', () => {
    const id = readIdentity(evt({
      'x-user-uid': 'uid-1',
      'x-user-email': 'a@b.c',
      'x-user-name': 'Alice',
      'x-tenant-id': 'acme',
      'x-plan': 'enterprise',
      'x-role': 'admin',
    }))
    expect(id).toEqual({
      uid: 'uid-1',
      email: 'a@b.c',
      name: 'Alice',
      tenantId: 'acme',
      plan: 'enterprise',
      role: 'admin',
    })
  })

  it('URL-decodes x-user-name (gateway encodes it)', () => {
    const id = readIdentity(evt({ 'x-user-uid': 'u', 'x-user-name': 'Jos%C3%A9%20P' }))
    expect(id.name).toBe('José P')
  })

  it('applies defaults for missing optional headers', () => {
    const id = readIdentity(evt({ 'x-user-uid': 'u' }))
    expect(id).toEqual({
      uid: 'u',
      email: '',
      name: '',
      tenantId: 'default',
      plan: 'free',
      role: 'traveler',
    })
  })
})
