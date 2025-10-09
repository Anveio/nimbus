import { describe, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

import { resolveIdentityConfig } from '../src/client/shared/identity'

describe('resolveIdentityConfig', () => {
  test('generates an Ed25519 identity by default', async () => {
    const identity = await resolveIdentityConfig(webcrypto as Crypto, undefined)
    expect(identity.mode).toBe('provided')
    expect(identity.algorithm).toBe('ed25519')

    const material = identity.material
    expect(material.kind).toBe('signer')
    const signature = await material.sign(new Uint8Array([1, 2, 3]))
    expect(signature).toBeInstanceOf(Uint8Array)
    expect(signature.length).toBe(64)
  })

  test('invokes onPublicKey callback when generating identity', async () => {
    const onPublicKey = vi.fn()
    await resolveIdentityConfig(webcrypto as Crypto, {
      mode: 'generated',
      algorithm: 'ed25519',
      onPublicKey,
    })
    expect(onPublicKey).toHaveBeenCalledTimes(1)
    const info = onPublicKey.mock.calls[0]![0]
    expect(info.algorithm).toBe('ed25519')
    expect(info.publicKey).toBeInstanceOf(Uint8Array)
    expect(info.openssh.startsWith('ssh-ed25519 ')).toBe(true)
  })

  test('returns provided identity unchanged', async () => {
    const provided = {
      mode: 'provided' as const,
      algorithm: 'ed25519' as const,
      material: {
        kind: 'signer' as const,
        publicKey: new Uint8Array(32),
        sign: vi.fn(async () => new Uint8Array(64)),
      },
    }
    const identity = await resolveIdentityConfig(webcrypto as Crypto, provided)
    expect(identity).toBe(provided)
  })
})
