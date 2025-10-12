import { afterEach, describe, expect, it, vi } from 'vitest'

const ENV_PREFIXES = ['VITE_NIMBUS_SIGNER_', 'VITE_MANA_SIGNER_']

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.restoreAllMocks()
})

function clearSignerEnv() {
  for (const key of Object.keys(import.meta.env)) {
    if (ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      vi.stubEnv(key, '')
    }
  }
}

describe('remote signer configuration', () => {
  it('returns null when configuration is absent', async () => {
    clearSignerEnv()
    const module = await import('./remote-signer')
    expect(module.getRemoteSignerConfig()).toBeNull()
  })

  it('exposes configuration when present', async () => {
    vi.stubEnv('VITE_NIMBUS_SIGNER_ENDPOINT', 'https://example.com/sign')
    vi.stubEnv('VITE_NIMBUS_SIGNER_TOKEN', 'token-123')
    vi.stubEnv(
      'VITE_NIMBUS_SIGNER_DEFAULT_ENDPOINT',
      'wss://example.com/socket',
    )
    vi.stubEnv('VITE_NIMBUS_SIGNER_DEFAULT_REGION', 'us-west-2')
    vi.stubEnv('VITE_NIMBUS_SIGNER_DEFAULT_SERVICE', 'ec2-instance-connect')
    vi.stubEnv('VITE_NIMBUS_SIGNER_MAX_EXPIRES', '120')
    vi.stubEnv('VITE_NIMBUS_SIGNER_DEFAULT_EXPIRES', '45')

    const module = await import('./remote-signer')
    const config = module.getRemoteSignerConfig()
    expect(config).not.toBeNull()
    expect(config?.endpoint).toBe('https://example.com/sign')
    expect(config?.bearerToken).toBe('token-123')
    expect(config?.defaults).toMatchObject({
      endpoint: 'wss://example.com/socket',
      region: 'us-west-2',
      service: 'ec2-instance-connect',
      maxExpires: 120,
      defaultExpires: 45,
    })
  })

  it('accepts legacy env names for backwards compatibility', async () => {
    vi.stubEnv('VITE_MANA_SIGNER_ENDPOINT', 'https://legacy.example.com/sign')
    vi.stubEnv('VITE_MANA_SIGNER_TOKEN', 'legacy-token')

    const module = await import('./remote-signer')
    const config = module.getRemoteSignerConfig()
    expect(config).not.toBeNull()
    expect(config?.endpoint).toBe('https://legacy.example.com/sign')
    expect(config?.bearerToken).toBe('legacy-token')
  })
})

describe('requestRemoteSignedUrl', () => {
  it('invokes fetch with bearer token and payload', async () => {
    vi.stubEnv('VITE_NIMBUS_SIGNER_ENDPOINT', 'https://example.com/sign')
    vi.stubEnv('VITE_NIMBUS_SIGNER_TOKEN', 'token-abc')

    const { requestRemoteSignedUrl } = await import('./remote-signer')

    const mockResponse = {
      ok: true,
      json: async () => ({
        signedUrl: 'wss://signed.example.com?token=123',
        expiresAt: new Date().toISOString(),
        defaults: {},
      }),
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse) as unknown as typeof fetch

    try {
      const payload = await requestRemoteSignedUrl({
        endpoint: 'wss://demo.example.com/path',
        region: 'us-west-2',
        service: 'ec2-instance-connect',
        expiresIn: 60,
      })

      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com/sign',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc',
            'Content-Type': 'application/json',
          }),
        }),
      )
      expect(payload.signedUrl).toBe('wss://signed.example.com?token=123')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('throws when configuration missing', async () => {
    clearSignerEnv()
    const { requestRemoteSignedUrl } = await import('./remote-signer')
    await expect(() =>
      requestRemoteSignedUrl({
        endpoint: 'wss://example.com',
        region: 'us-west-2',
        service: 'ec2-instance-connect',
        expiresIn: 30,
      }),
    ).rejects.toThrow(/configuration is not available/)
  })
})
