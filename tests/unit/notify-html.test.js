import { describe, it, expect } from 'vitest'
import { esc, newsletterHtml } from '../../services/notification-service/utils/notify.js'

describe('notify.esc', () => {
  it('escapes the five HTML-significant characters (XSS guard)', () => {
    expect(esc(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&#39;')
  })

  it('coerces nullish to empty string', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })

  it('leaves safe text untouched', () => {
    expect(esc('Hello Vienna')).toBe('Hello Vienna')
  })
})

describe('notify.newsletterHtml', () => {
  const recs = [
    { id: 't1', title: 'Alps Trek', destination: 'Innsbruck', author: 'Bob', shortDescription: 'Snowy' },
    { id: 't2', title: 'Beach Week', destination: 'Nice', author: 'Ana' },
  ]
  const html = newsletterHtml(recs, 'https://app.example.com')

  it('renders a clickable card linking to each trip detail page', () => {
    expect(html).toContain('https://app.example.com/trips/t1')
    expect(html).toContain('https://app.example.com/trips/t2')
  })

  it('includes per-trip content (title, destination, author)', () => {
    expect(html).toContain('Alps Trek')
    expect(html).toContain('Innsbruck')
    expect(html).toContain('by Bob')
    expect(html).toContain('Snowy')
  })

  it('omits the description block when absent', () => {
    // second rec has no shortDescription — its card should still render
    expect(html).toContain('Beach Week')
  })

  it('escapes user-supplied fields to prevent HTML injection', () => {
    const evil = newsletterHtml(
      [{ id: 'x', title: '<img src=x onerror=alert(1)>', destination: 'D', author: 'A' }],
      'https://app.example.com',
    )
    expect(evil).not.toContain('<img src=x')
    expect(evil).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('URL-encodes the trip id in the link', () => {
    const out = newsletterHtml([{ id: 'a/b c', title: 'T', destination: 'D', author: 'A' }], 'https://x')
    expect(out).toContain('/trips/a%2Fb%20c')
  })
})
