import { describe, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

import { resolveIdentityConfig } from '../src/client/shared/identity'

describe('resolveIdentityConfig', () => {
  test('generates an Ed25519 identity by default', async () => {
    const identity = await resolveIdentityConfig(webcrypto as Crypto, {
      mode: 'generated',
      username: 'alice',
    })
    expect(identity.username).toBe('alice')
    expect(identity.algorithm).toBe('ssh-ed25519')
    const signature = await identity.sign(new Uint8Array([1, 2, 3]))
    expect(signature).toBeInstanceOf(Uint8Array)
    expect(signature.length).toBe(64)
    expect(identity.openssh?.startsWith('ssh-ed25519 ')).toBe(true)
  })

  test('invokes onPublicKey callback when generating identity', async () => {
    const onPublicKey = vi.fn()
    await resolveIdentityConfig(webcrypto as Crypto, {
      mode: 'generated',
      algorithm: 'ed25519',
      username: 'charlie',
      onPublicKey,
    })
    expect(onPublicKey).toHaveBeenCalledTimes(1)
    const info = onPublicKey.mock.calls[0]![0]
    expect(info.algorithm).toBe('ed25519')
    expect(info.publicKey).toBeInstanceOf(Uint8Array)
    expect(info.openssh.startsWith('ssh-ed25519 ')).toBe(true)
  })

  test('returns provided identity unchanged', async () => {
    const provided = await resolveIdentityConfig(webcrypto as Crypto, {
      mode: 'provided',
      username: 'bob',
      algorithm: 'ed25519',
      material: {
        kind: 'signer',
        publicKey: new Uint8Array(32),
        sign: vi.fn(async () => new Uint8Array(64)),
      },
    })
    expect(provided.username).toBe('bob')
    expect(provided.algorithm).toBe('ssh-ed25519')
    const signature = await provided.sign(new Uint8Array([4, 5, 6]))
    expect(signature).toBeInstanceOf(Uint8Array)
    expect(signature.length).toBe(64)
  })
})
