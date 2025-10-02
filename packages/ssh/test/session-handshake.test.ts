import { describe, expect, it } from 'vitest'

import type { AlgorithmCatalog, AlgorithmName, SshClientConfig, SshEvent } from '../src/api'
import { createClientSession } from '../src/api'
import { SshProtocolError } from '../src/errors'
import { BinaryWriter } from '../src/internal/binary/binary-writer'

const encoder = new TextEncoder()

const zeroBytes = (length: number): Uint8Array => new Uint8Array(length)

const asAlgo = (value: string): AlgorithmName => value as AlgorithmName

const defaultAlgorithms: AlgorithmCatalog = {
  keyExchange: [
    asAlgo('curve25519-sha256@libssh.org'),
    asAlgo('diffie-hellman-group14-sha256'),
  ],
  ciphers: [asAlgo('chacha20-poly1305@openssh.com'), asAlgo('aes128-gcm@openssh.com')],
  macs: [asAlgo('hmac-sha2-256'), asAlgo('hmac-sha2-512')],
  hostKeys: [asAlgo('ssh-ed25519'), asAlgo('rsa-sha2-256')],
  compression: [asAlgo('none')],
  extensions: [asAlgo('ext-info-c')],
}

function createConfig(overrides: Partial<SshClientConfig> = {}): SshClientConfig {
  return {
    clock: () => 0,
    randomBytes: zeroBytes,
    identification: {
      clientId: 'SSH-2.0-mana-ssh-web_0.1',
    },
    algorithms: defaultAlgorithms,
    hostKeys: {
      async evaluate() {
        return { outcome: 'unknown' as const }
      },
    },
    ...overrides,
  }
}

function drainEvents(sessionEvents: () => SshEvent | undefined): SshEvent[] {
  const events: SshEvent[] = []
  let evt: SshEvent | undefined
  // eslint-disable-next-line no-cond-assign
  while ((evt = sessionEvents())) {
    events.push(evt)
  }
  return events
}

function buildServerKexInitPacket(): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint8(20)
  writer.writeBytes(zeroBytes(16))
  writer.writeNameList(['curve25519-sha256@libssh.org'])
  writer.writeNameList(['ssh-ed25519'])
  writer.writeNameList(['chacha20-poly1305@openssh.com'])
  writer.writeNameList(['chacha20-poly1305@openssh.com'])
  writer.writeNameList(['hmac-sha2-256'])
  writer.writeNameList(['hmac-sha2-256'])
  writer.writeNameList(['none'])
  writer.writeNameList(['none'])
  writer.writeNameList([])
  writer.writeNameList([])
  writer.writeBoolean(false)
  writer.writeUint32(0)
  const payload = writer.toUint8Array()

  const paddingLength = 4
  const packetLength = payload.length + paddingLength + 1
  const outer = new BinaryWriter()
  outer.writeUint32(packetLength)
  outer.writeUint8(paddingLength)
  outer.writeBytes(payload)
  outer.writeBytes(Uint8Array.from({ length: paddingLength }, (_, i) => i + 1))
  return outer.toUint8Array()
}

describe('ClientSessionImpl Phase 1 handshake', () => {
  it('emits identification and outbound data immediately on creation', () => {
    const session = createClientSession(createConfig())

    const first = session.nextEvent()
    expect(first).toEqual({
      type: 'identification-sent',
      clientId: 'SSH-2.0-mana-ssh-web_0.1',
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

  it('processes server identification lines, sends KEXINIT, and parses server KEXINIT', () => {
    const session = createClientSession(createConfig())
    // drain initial events
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverIdentification = encoder.encode('SSH-2.0-OpenSSH_9.6\r\n')
    const packet = buildServerKexInitPacket()
    const combined = new Uint8Array(serverIdentification.length + packet.length)
    combined.set(serverIdentification, 0)
    combined.set(packet, serverIdentification.length)

    session.receive(combined)

    const events = drainEvents(() => session.nextEvent())
    expect(events.map((evt) => evt.type)).toEqual([
      'identification-received',
      'kex-init-sent',
      'outbound-data',
      'kex-init-received',
    ])

    const flushAfterKex = session.flushOutbound()
    expect(flushAfterKex).toHaveLength(1)

    const identificationEvent = events[0] as Extract<SshEvent, { type: 'identification-received' }>
    expect(identificationEvent.serverId).toBe('SSH-2.0-OpenSSH_9.6')

    const kexSent = events[1] as Extract<SshEvent, { type: 'kex-init-sent' }>
    expect(kexSent.summary.client).toEqual([
      'curve25519-sha256@libssh.org',
      'diffie-hellman-group14-sha256',
      'ext-info-c',
    ])

    const kexReceived = events[3] as Extract<SshEvent, { type: 'kex-init-received' }>
    expect(kexReceived.summary.server).toEqual(['curve25519-sha256@libssh.org'])

    expect(session.inspect().phase).toBe('kex')
  })

  it('rejects server identification strings longer than 255 characters', () => {
    const session = createClientSession(createConfig())
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const longId = 'SSH-2.0-' + 'a'.repeat(250) + '\r\n'
    const bytes = encoder.encode(longId)

    expect(() => session.receive(bytes)).toThrowError(SshProtocolError)
  })
})

