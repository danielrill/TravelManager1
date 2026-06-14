import { describe, it, expect } from 'vitest'
import { subdomainOf, isAdminSub } from '../../services/api-gateway/utils/tenant-host.js'

const ROOT = 'onecloudaway.de'

describe('subdomainOf', () => {
  it('returns empty for the apex', () => {
    expect(subdomainOf('onecloudaway.de', ROOT)).toBe('')
  })
  it('treats www as apex', () => {
    expect(subdomainOf('www.onecloudaway.de', ROOT)).toBe('')
  })
  it('extracts a tenant subdomain', () => {
    expect(subdomainOf('tui.onecloudaway.de', ROOT)).toBe('tui')
  })
  it('extracts the admin subdomain', () => {
    expect(subdomainOf('admin.onecloudaway.de', ROOT)).toBe('admin')
  })
  it('ignores port and case', () => {
    expect(subdomainOf('TUI.onecloudaway.de:443', ROOT)).toBe('tui')
  })
  it('uses only the first label for nested hosts', () => {
    expect(subdomainOf('a.b.onecloudaway.de', ROOT)).toBe('a')
  })
  it('falls back to apex for localhost / unknown hosts (dev)', () => {
    expect(subdomainOf('localhost', ROOT)).toBe('')
    expect(subdomainOf('127.0.0.1', ROOT)).toBe('')
    expect(subdomainOf('', ROOT)).toBe('')
  })
})

describe('isAdminSub', () => {
  it('is true only for admin', () => {
    expect(isAdminSub('admin')).toBe(true)
    expect(isAdminSub('tui')).toBe(false)
    expect(isAdminSub('')).toBe(false)
  })
})
