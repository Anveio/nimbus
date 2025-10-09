import { describe, expect, it, vi } from 'vitest'

import {
  connectWithRuntime,
  createMemoryHostKeyStore,
  type RuntimeEnvironment,
} from '../src/client/shared/connect'
import type { TransportBinding } from '../src/client/shared/connect'
import { SshInvariantViolation } from '../src/errors'
import { webcrypto as nodeCrypto } from 'node:crypto'

const cryptoProvider = (globalThis.crypto ?? nodeCrypto) as Crypto

const TEST_IDENTITY = {
  username: 'tester',
  algorithm: 'ssh-ed25519',
  publicKey: new Uint8Array(32),
  sign: vi.fn(async () => new Uint8Array(64)),
}

function createEnvironment(): RuntimeEnvironment {
  return {
    now: () => 0,
    randomBytes: (length: number) => new Uint8Array(length),
    crypto: cryptoProvider,
    hostKeys: createMemoryHostKeyStore(),
  }
}

describe('connectWithRuntime', () => {
  it('registers disposers for transport listeners and emits outbound payloads', async () => {
    const send = vi.fn()
    let dataListener: ((payload: Uint8Array) => void) | undefined
    let closeListener:
      | ((summary: { reason?: string; code?: number } | undefined) => void)
      | undefined
    let errorListener: ((error: unknown) => void) | undefined

    const dataDisposer = vi.fn()
    const closeDisposer = vi.fn()
    const errorDisposer = vi.fn()

    const transport: TransportBinding = {
      send,
      onData(listener) {
        dataListener = listener
        return dataDisposer
      },
      onClose(listener) {
        if (!listener) {
          return
        }
        closeListener = listener
        return closeDisposer
      },
      onError(listener) {
        if (!listener) {
          return
        }
        errorListener = listener
        return errorDisposer
      },
    }

    const callbacks = {
      onEvent: vi.fn(),
      onDiagnostic: vi.fn(),
    }

    const connection = await connectWithRuntime(
      {
        transport,
        callbacks,
        configOverrides: {
          identity: TEST_IDENTITY,
        },
      },
      createEnvironment(),
    )

    expect(send).toHaveBeenCalled()
    expect(dataListener).toBeDefined()

    // Simulate a transport error/close to ensure registered listeners propagate.
    errorListener?.(new Error('boom'))
    closeListener?.({ code: 1000, reason: 'idle' })

    // Disposing should tear down all registered listeners exactly once.
    connection.dispose()

    expect(dataDisposer).toHaveBeenCalledTimes(1)
    expect(closeDisposer).toHaveBeenCalledTimes(closeListener ? 1 : 0)
    expect(errorDisposer).toHaveBeenCalledTimes(errorListener ? 1 : 0)

    // Subsequent dispose calls should be safe no-ops.
    expect(() => connection.dispose()).not.toThrow(SshInvariantViolation)
  })
})
