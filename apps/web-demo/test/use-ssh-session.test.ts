import { describe, expect, it } from 'vitest'

import {
  initialSessionState,
  sessionReducer,
  type PublicKeyInfo,
} from '../src/hooks/use-ssh-session'

describe('sessionReducer', () => {
  it('moves through the happy-path connection lifecycle', () => {
    const connecting = sessionReducer(initialSessionState, {
      type: 'start-connect',
    })
    expect(connecting.phase).toBe('connecting')
    expect(connecting.connectionState).toBe('connecting')
    expect(connecting.publicKey).toBeNull()

    const connected = sessionReducer(connecting, {
      type: 'connected',
      state: 'authenticating',
    })
    expect(connected.phase).toBe('connected')
    expect(connected.connectionState).toBe('authenticating')
    expect(connected.publicKey).toBeNull()

    const mockKey: PublicKeyInfo = {
      algorithm: 'rsa-sha2-512',
      openssh: 'ssh-rsa AAAAB3Nza...',
    }
    const withKey = sessionReducer(connected, {
      type: 'set-public-key',
      publicKey: mockKey,
    })
    expect(withKey.publicKey).toEqual(mockKey)

    const ready = sessionReducer(withKey, {
      type: 'connection-state',
      state: 'ready',
    })
    expect(ready.connectionState).toBe('ready')
    expect(ready.publicKey).toEqual(mockKey)
  })

  it('captures failures and resets on disconnect', () => {
    const failed = sessionReducer(initialSessionState, {
      type: 'failure',
      error: 'boom',
    })
    expect(failed.phase).toBe('error')
    expect(failed.connectionState).toBe('closed')
    expect(failed).toMatchObject({ error: 'boom' })

    const reset = sessionReducer(failed, { type: 'disconnect' })
    expect(reset.phase).toBe('idle')
    expect(reset.connectionState).toBe('closed')
    expect(reset.publicKey).toBeNull()
  })

  it('ignores public key updates when not connected', () => {
    const idle = sessionReducer(initialSessionState, {
      type: 'set-public-key',
      publicKey: {
        algorithm: 'ignored',
        openssh: 'ignored',
      },
    })
    expect(idle.publicKey).toBeNull()
  })
})
