import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// geocodeCity hits a geocoding REST API over global $fetch and memoises in a
// module-level Map. Reload per test to clear that cache; stub $fetch. With no
// GOOGLE_MAPS_SERVER_KEY it uses the keyless Open-Meteo path.
const savedEnv = { ...process.env }

async function load(env = {}) {
  vi.resetModules()
  process.env = { ...savedEnv }
  delete process.env.GOOGLE_MAPS_SERVER_KEY
  Object.assign(process.env, env)
  return import('@travelmanager/shared/geocode')
}

let fetchMock
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('$fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...savedEnv } })

describe('geocode.geocodeCity', () => {
  it('resolves a place via the keyless Open-Meteo API', async () => {
    fetchMock.mockResolvedValue({ results: [{ name: 'Vienna', country: 'Austria', latitude: 48.2, longitude: 16.3 }] })
    const { geocodeCity } = await load()
    expect(await geocodeCity('Vienna')).toEqual({
      lat: 48.2, lng: 16.3, formatted: 'Vienna, Austria', country: 'Austria',
    })
  })

  it('takes only the first place from a multi-place string', async () => {
    fetchMock.mockResolvedValue({ results: [{ name: 'Vienna', country: 'Austria', latitude: 48.2, longitude: 16.3 }] })
    const { geocodeCity } = await load()
    await geocodeCity('Vienna & Salzburg')
    expect(fetchMock.mock.calls[0][1].query.name).toBe('Vienna')
  })

  it('returns null when nothing matches', async () => {
    fetchMock.mockResolvedValue({ results: [] })
    const { geocodeCity } = await load()
    expect(await geocodeCity('Atlantis')).toBeNull()
  })

  it('returns null for an empty query without calling the API', async () => {
    const { geocodeCity } = await load()
    expect(await geocodeCity('')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('memoises results (one network call for repeated lookups)', async () => {
    fetchMock.mockResolvedValue({ results: [{ name: 'Rome', country: 'Italy', latitude: 41.9, longitude: 12.5 }] })
    const { geocodeCity } = await load()
    await geocodeCity('Rome')
    await geocodeCity('Rome')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never throws — a failing lookup resolves to null', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const { geocodeCity } = await load()
    expect(await geocodeCity('Paris')).toBeNull()
  })

  it('uses Google geocoding when a server key is configured', async () => {
    fetchMock.mockResolvedValue({
      status: 'OK',
      results: [{
        formatted_address: 'Paris, France',
        geometry: { location: { lat: 48.8566, lng: 2.3522 } },
        address_components: [{ long_name: 'France', types: ['country'] }],
      }],
    })
    const { geocodeCity } = await load({ GOOGLE_MAPS_SERVER_KEY: 'gmaps-key' })
    expect(await geocodeCity('Paris')).toEqual({
      lat: 48.8566, lng: 2.3522, formatted: 'Paris, France', country: 'France',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { query: { address: 'Paris', key: 'gmaps-key' } },
    )
  })

  it('falls back to Open-Meteo when Google has no usable hit', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 'ZERO_RESULTS', results: [] })
      .mockResolvedValueOnce({ results: [{ name: 'Paris', country: 'France', latitude: 48.8, longitude: 2.3 }] })
    const { geocodeCity } = await load({ GOOGLE_MAPS_SERVER_KEY: 'gmaps-key' })
    expect(await geocodeCity('Paris')).toEqual({
      lat: 48.8, lng: 2.3, formatted: 'Paris, France', country: 'France',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://geocoding-api.open-meteo.com/v1/search')
  })
})
