import { describe, expect, it } from 'vitest'

import type { SshEvent } from '../src/api'
import { createClientSession } from '../src/api'
import { SshProtocolError } from '../src/errors'
import {
  TEST_ALGORITHMS,
  buildServerKexInitPacket,
  createTestClientConfig,
  drainSessionEvents,
  encodeIdentificationLine,
} from './helpers/session-fixtures'

const encoder = new TextEncoder()

describe('ClientSessionImpl Phase 1 handshake', () => {
  it('emits identification and outbound data immediately on creation', () => {
    const session = createClientSession(
      createTestClientConfig({ guards: { disableAutoUserAuth: true } }),
    )

    const first = session.nextEvent()
    expect(first).toEqual({
      type: 'identification-sent',
      clientId: 'SSH-2.0-nimbus-ssh-web_0.1',
    })

    const second = session.nextEvent()
    expect(second).toBeDefined()
    expect(second?.type).toBe('outbound-data')
    if (second?.type !== 'outbound-data') {
      throw new Error('Expected outbound-data event after identification')
    }
    expect(second.encryption).toBe('initial')

    const outbound = session.flushOutbound()
    expect(outbound).toHaveLength(1)
    expect(outbound[0]).toEqual(second.payload)
  })

  it('processes server identification lines, sends KEXINIT, and parses server KEXINIT', async () => {
    const session = createClientSession(
      createTestClientConfig({ guards: { disableAutoUserAuth: true } }),
    )
    // drain initial events
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverIdentification = encodeIdentificationLine('SSH-2.0-OpenSSH_9.6')
    const packet = buildServerKexInitPacket()
    const combined = new Uint8Array(serverIdentification.length + packet.length)
    combined.set(serverIdentification, 0)
    combined.set(packet, serverIdentification.length)

    session.receive(combined)
    await session.waitForIdle()
    await session.waitForIdle()

    const events = drainSessionEvents(session)
    expect(events.map((evt) => evt.type)).toEqual([
      'identification-received',
      'kex-init-sent',
      'kex-init-received',
      'outbound-data',
      'client-public-key-ready',
      'outbound-data',
    ])

    const flushAfterKex = session.flushOutbound()
    expect(flushAfterKex).toHaveLength(2)

    const identificationEvent = events[0] as Extract<
      SshEvent,
      { type: 'identification-received' }
    >
    expect(identificationEvent.serverId).toBe('SSH-2.0-OpenSSH_9.6')

    const kexSent = events[1] as Extract<SshEvent, { type: 'kex-init-sent' }>
    const expectedClientAlgorithms = [
      ...TEST_ALGORITHMS.keyExchange,
      ...(TEST_ALGORITHMS.extensions ?? []),
    ]
    expect(kexSent.summary.client).toEqual(expectedClientAlgorithms)

    const kexReceived = events[2] as Extract<
      SshEvent,
      { type: 'kex-init-received' }
    >
    expect(kexReceived.summary.server).toEqual(['curve25519-sha256@libssh.org'])

    expect(session.inspect().phase).toBe('kex')
  })

  it('rejects server identification strings longer than 255 characters', () => {
    const session = createClientSession(
      createTestClientConfig({ guards: { disableAutoUserAuth: true } }),
    )
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const longId = 'SSH-2.0-' + 'a'.repeat(250) + '\r\n'
    const bytes = encoder.encode(longId)

    expect(() => session.receive(bytes)).toThrowError(SshProtocolError)
  })
})
