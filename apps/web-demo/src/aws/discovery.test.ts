import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDiscoveryMetadata } from './discovery'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('fetchDiscoveryMetadata', () => {
  it('throws when endpoint missing', async () => {
    vi.stubEnv('VITE_MANA_DISCOVERY_ENDPOINT', '')
    vi.stubEnv('VITE_MANA_SIGNER_TOKEN', 'token')
    await expect(() => fetchDiscoveryMetadata()).rejects.toThrow(
      /Discovery endpoint not configured/,
    )
  })

  it('throws when signer token missing', async () => {
    vi.stubEnv('VITE_MANA_DISCOVERY_ENDPOINT', 'https://example.com/discovery')
    vi.stubEnv('VITE_MANA_SIGNER_TOKEN', '')
    await expect(() => fetchDiscoveryMetadata()).rejects.toThrow(
      /Signer token not configured/,
    )
  })

  it('invokes discovery endpoint with bearer token', async () => {
    vi.stubEnv('VITE_MANA_DISCOVERY_ENDPOINT', 'https://example.com/discovery')
    vi.stubEnv('VITE_MANA_SIGNER_TOKEN', 'token-1')

    const mockResponse = {
      ok: true,
      json: async () => ({
        region: 'us-west-2',
        instances: [],
        instanceConnectEndpoints: [],
        vpcs: [],
      }),
    }

    const originalFetch = globalThis.fetch
    const mockFetch = vi.fn().mockResolvedValue(mockResponse)
    globalThis.fetch = mockFetch as unknown as typeof fetch

    try {
      const result = await fetchDiscoveryMetadata('us-west-2')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com/discovery',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-1',
            'Content-Type': 'application/json',
          }),
        }),
      )
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      expect(lastCall).toBeDefined()
      const [, init] = lastCall!
      const payload =
        typeof init?.body === 'string'
          ? init.body
          : init?.body == null
            ? '{}'
            : JSON.stringify(init.body)
      expect(JSON.parse(payload)).toEqual({ region: 'us-west-2' })
      expect(result.region).toBe('us-west-2')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
