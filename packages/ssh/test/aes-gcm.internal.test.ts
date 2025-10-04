import { describe, expect, test } from 'vitest'

import { encryptAesGcm, importAesGcmKey } from '../src/internal/crypto/aes-gcm'

const createKey = async () => {
  const keyBytes = Uint8Array.from({ length: 16 }, (_, index) => index)
  return importAesGcmKey(globalThis.crypto!, keyBytes)
}

describe('AES-GCM helper utilities', () => {
  test('increments invocation and sequence counters after encryption', async () => {
    const key = await createKey()
    const state = {
      algorithm: 'aes128-gcm@openssh.com' as const,
      key,
      fixedIv: new Uint8Array([0, 0, 0, 1]),
      invocationCounter: 0n,
      sequenceNumber: 0,
    }

    const plaintext = Uint8Array.from({ length: 32 }, (_, index) => index)
    const additionalData = new Uint8Array(4)

    const { ciphertext, tagLength } = await encryptAesGcm({
      crypto: globalThis.crypto!,
      state,
      plaintext,
      additionalData,
    })

    expect(ciphertext.length).toBe(plaintext.length + tagLength)
    expect(state.invocationCounter).toBe(1n)
    expect(state.sequenceNumber).toBe(1)
  })

  test('rejects when sequence number space is exhausted', async () => {
    const key = await createKey()
    const state = {
      algorithm: 'aes128-gcm@openssh.com' as const,
      key,
      fixedIv: new Uint8Array([0, 0, 0, 2]),
      invocationCounter: 0n,
      sequenceNumber: 0xffff_ffff,
    }

    const plaintext = new Uint8Array(16)
    const additionalData = new Uint8Array(4)

    await expect(
      encryptAesGcm({
        crypto: globalThis.crypto!,
        state,
        plaintext,
        additionalData,
      }),
    ).rejects.toThrow('sequence number')
  })

  test('rejects when invocation counter space is exhausted', async () => {
    const key = await createKey()
    const state = {
      algorithm: 'aes128-gcm@openssh.com' as const,
      key,
      fixedIv: new Uint8Array([0, 0, 0, 3]),
      invocationCounter: 0xffff_ffff_ffff_ffffn,
      sequenceNumber: 0,
    }

    const plaintext = new Uint8Array(16)
    const additionalData = new Uint8Array(4)

    await expect(
      encryptAesGcm({
        crypto: globalThis.crypto!,
        state,
        plaintext,
        additionalData,
      }),
    ).rejects.toThrow('invocation counter')
  })
})
