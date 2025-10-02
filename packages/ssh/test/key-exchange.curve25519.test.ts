import { describe, expect, test, vi } from 'vitest'

import type { HostKeyDecision, SshEvent } from '../src/api'
import { createClientSession } from '../src/api'
import {
  RecordingHostKeyStore,
  buildEd25519HostKeyBlob,
  buildEd25519Signature,
  buildServerKexInitPacket,
  createTestClientConfig,
  drainSessionEvents,
  encodeIdentificationLine,
  createBypassSignatureCrypto,
  hexToUint8Array,
  wrapSshPacket,
} from './helpers/session-fixtures'
import { BinaryReader } from '../src/internal/binary/binary-reader'
import { BinaryWriter } from '../src/internal/binary/binary-writer'
import { clampScalar, scalarMultBase } from '../src/internal/crypto/x25519'

const SSH_MSG_KEX_ECDH_INIT = 30
const SSH_MSG_KEX_ECDH_REPLY = 31
const SSH_MSG_NEWKEYS = 21

function buildNewKeysPacket(): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint8(SSH_MSG_NEWKEYS)
  return wrapSshPacket(writer.toUint8Array())
}

const CURVE25519_CLIENT_SCALAR = hexToUint8Array(
  'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4',
)
const CURVE25519_SERVER_PUBLIC = hexToUint8Array(
  'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c',
)

function buildCurve25519ReplyPacket(): Uint8Array {
  const payloadWriter = new BinaryWriter()
  payloadWriter.writeUint8(SSH_MSG_KEX_ECDH_REPLY)
  payloadWriter.writeUint32(buildEd25519HostKeyBlob().length)
  payloadWriter.writeBytes(buildEd25519HostKeyBlob())
  payloadWriter.writeUint32(CURVE25519_SERVER_PUBLIC.length)
  payloadWriter.writeBytes(CURVE25519_SERVER_PUBLIC)
  payloadWriter.writeUint32(buildEd25519Signature().length)
  payloadWriter.writeBytes(buildEd25519Signature())
  const payload = payloadWriter.toUint8Array()
  return wrapSshPacket(payload)
}

function expectEventTypes(events: ReadonlyArray<SshEvent>, expected: ReadonlyArray<SshEvent['type']>): void {
  expect(events.map((event) => event.type)).toEqual(expected)
}

function unwrapPayload(packet: Uint8Array): Uint8Array {
  const reader = new BinaryReader(packet)
  const packetLength = reader.readUint32()
  const paddingLength = reader.readUint8()
  const payloadLength = packetLength - paddingLength - 1
  return reader.readBytes(payloadLength)
}

describe('RFC 5656 §4.1 curve25519 key exchange', () => {
  test('completes ECDH and emits keys-established with NEWKEYS pending', async () => {
    const decision: HostKeyDecision = { outcome: 'trusted', source: 'known-hosts' }
    const hostKeys = new RecordingHostKeyStore(decision)

    const randomBytes = vi.fn((length: number) => {
      if (length === 16) {
        return new Uint8Array(16) // cookie + padding bytes
      }
      if (length === 32) {
        return CURVE25519_CLIENT_SCALAR
      }
      return new Uint8Array(length)
    })

    const session = createClientSession(
      createTestClientConfig({
        hostKeys,
        randomBytes,
        crypto: createBypassSignatureCrypto(),
      }),
    )

    // drain initial outbound messages
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverIdentification = encodeIdentificationLine('SSH-2.0-OpenSSH_9.6')
    const serverKexInit = buildServerKexInitPacket({
      kexAlgorithms: ['curve25519-sha256@libssh.org'],
      hostKeys: ['ssh-ed25519'],
      encryptionClientToServer: ['chacha20-poly1305@openssh.com'],
      encryptionServerToClient: ['chacha20-poly1305@openssh.com'],
      macClientToServer: ['hmac-sha2-256'],
      macServerToClient: ['hmac-sha2-256'],
      compressionClientToServer: ['none'],
      compressionServerToClient: ['none'],
    })

    const combined = new Uint8Array(serverIdentification.length + serverKexInit.length)
    combined.set(serverIdentification)
    combined.set(serverKexInit, serverIdentification.length)

    session.receive(combined)
    await session.waitForIdle()

    const postNegotiationEvents = drainSessionEvents(session)
    expectEventTypes(postNegotiationEvents, [
      'identification-received',
      'kex-init-sent',
      'outbound-data',
      'kex-init-received',
      'outbound-data',
    ])

    const outboundAfterNegotiation = session.flushOutbound()
    expect(outboundAfterNegotiation).toHaveLength(2)

    const [, ecdhInitPacket] = outboundAfterNegotiation
    const ecdhInitPayload = unwrapPayload(ecdhInitPacket!)
    expect(ecdhInitPayload[0]).toBe(SSH_MSG_KEX_ECDH_INIT)
    const publicKeyLength = new DataView(ecdhInitPayload.buffer, ecdhInitPayload.byteOffset + 1, 4).getUint32(0, false)
    expect(publicKeyLength).toBe(32)
    const clientPublic = ecdhInitPayload.slice(5, 5 + publicKeyLength)
    const expectedPublic = scalarMultBase(clampScalar(CURVE25519_CLIENT_SCALAR))
    expect(clientPublic).toEqual(expectedPublic)

    // Feed placeholder reply and drive key establishment.
    session.receive(buildCurve25519ReplyPacket())
    await session.waitForIdle()
    const eventsAfterReply = drainSessionEvents(session)
    expectEventTypes(eventsAfterReply, ['keys-established', 'outbound-data'])

    const outboundAfterReply = session.flushOutbound()
    expect(outboundAfterReply).toHaveLength(1)
    const newKeysPayload = unwrapPayload(outboundAfterReply[0]!)
    expect(newKeysPayload[0]).toBe(SSH_MSG_NEWKEYS)

    expect(hostKeys.evaluations).toHaveLength(1)

    session.receive(buildNewKeysPacket())
    await session.waitForIdle()
    expect(session.inspect().phase).toBe('authenticated')
  })
})
