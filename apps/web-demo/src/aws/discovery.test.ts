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
    await expect(() => fetchDiscoveryMetadata()).rejects.toThrow(/Discovery endpoint not configured/)
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
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    try {
      const result = await fetchDiscoveryMetadata('us-west-2')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com/discovery',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-1',
          }),
        }),
      )
      expect(result.region).toBe('us-west-2')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
