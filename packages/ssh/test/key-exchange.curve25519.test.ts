import { describe, expect, test, vi } from 'vitest'

import type { HostKeyDecision, SshEvent } from '../src/api'
import { createClientSession } from '../src/api'
import {
  RecordingHostKeyStore,
  TEST_ALGORITHMS,
  buildEd25519HostKeyBlob,
  buildEd25519Signature,
  buildClientKexInitPayload,
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
import { deriveKeyMaterial } from '../src/internal/crypto/kdf'
import {
  encryptAesGcm,
  importAesGcmKey,
  splitInitialIv,
} from '../src/internal/crypto/aes-gcm'
import { clampScalar, scalarMult, scalarMultBase } from '../src/internal/crypto/x25519'

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

const littleEndianToBigInt = (bytes: Uint8Array): bigint => {
  let result = 0n
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    result = (result << 8n) + BigInt(bytes[i] ?? 0)
  }
  return result
}

const asciiEncoder = new TextEncoder()

const AES_MIN_PADDING = 4

const concatUint8Arrays = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const encodeStringField = (data: Uint8Array): Uint8Array => {
  const writer = new BinaryWriter()
  writer.writeUint32(data.length)
  writer.writeBytes(data)
  return writer.toUint8Array()
}

const encodeMpintField = (value: bigint): Uint8Array => {
  const writer = new BinaryWriter()
  writer.writeMpint(value)
  return writer.toUint8Array()
}

const toDigestBuffer = (view: Uint8Array): ArrayBuffer => {
  const copy = view.slice()
  return copy.buffer as ArrayBuffer
}

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
      encryptionClientToServer: ['aes128-gcm@openssh.com'],
      encryptionServerToClient: ['aes128-gcm@openssh.com'],
      macClientToServer: ['AEAD_AES_128_GCM'],
      macServerToClient: ['AEAD_AES_128_GCM'],
      compressionClientToServer: ['none'],
      compressionServerToClient: ['none'],
    })

    const combined = new Uint8Array(serverIdentification.length + serverKexInit.length)
    combined.set(serverIdentification)
    combined.set(serverKexInit, serverIdentification.length)

    session.receive(combined)
    await session.waitForIdle()
    await session.waitForIdle()

    const postNegotiationEvents = drainSessionEvents(session)
    expectEventTypes(postNegotiationEvents, [
      'identification-received',
      'kex-init-sent',
      'kex-init-received',
      'outbound-data',
      'outbound-data',
    ])

    const expectedClientKexPayload = buildClientKexInitPayload(TEST_ALGORITHMS, randomBytes)
    const outboundAfterNegotiation = session.flushOutbound()
    expect(outboundAfterNegotiation).toHaveLength(2)

    const [clientKexPacket, ecdhInitPacket] = outboundAfterNegotiation
    const clientKexPayload = unwrapPayload(clientKexPacket!)
    const ecdhInitPayload = unwrapPayload(ecdhInitPacket!)
    expect(clientKexPayload).toEqual(expectedClientKexPayload)
    expect(ecdhInitPayload[0]).toBe(SSH_MSG_KEX_ECDH_INIT)
    const publicKeyLength = new DataView(ecdhInitPayload.buffer, ecdhInitPayload.byteOffset + 1, 4).getUint32(0, false)
    expect(publicKeyLength).toBe(32)
    const clientPublic = ecdhInitPayload.slice(5, 5 + publicKeyLength)
    const expectedPublic = scalarMultBase(clampScalar(CURVE25519_CLIENT_SCALAR))
    expect(clientPublic).toEqual(expectedPublic)

    // Feed placeholder reply and drive key establishment.
    session.receive(buildCurve25519ReplyPacket())
    await session.waitForIdle()
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

  test('decrypts AES-GCM server payload after NEWKEYS', async () => {
    const hostKeys = new RecordingHostKeyStore({ outcome: 'trusted', source: 'known-hosts' })

    const randomBytes = vi.fn((length: number) => {
      if (length === 16) {
        return new Uint8Array(16)
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

    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverIdentification = encodeIdentificationLine('SSH-2.0-OpenSSH_9.6')
    const serverKexInitPacket = buildServerKexInitPacket()
    const combined = new Uint8Array(serverIdentification.length + serverKexInitPacket.length)
    combined.set(serverIdentification)
    combined.set(serverKexInitPacket, serverIdentification.length)

    session.receive(combined)
    await session.waitForIdle()
    await session.waitForIdle()

    const negotiationEvents = drainSessionEvents(session)
    const expectedClientKexPayload = buildClientKexInitPayload(TEST_ALGORITHMS, randomBytes)
    const outboundPackets = session.flushOutbound()
    expect(outboundPackets).toHaveLength(2)
    const [clientKexPacket, ecdhInitPacket] = outboundPackets

    const clientKexPayload = unwrapPayload(clientKexPacket!)
    expect(clientKexPayload).toEqual(expectedClientKexPayload)
    const serverKexPayload = unwrapPayload(serverKexInitPacket)
    const ecdhPayload = unwrapPayload(ecdhInitPacket)
    const serverHostKey = buildEd25519HostKeyBlob()

    session.receive(buildCurve25519ReplyPacket())
    await session.waitForIdle()
    await session.waitForIdle()

    const postKexEvents = drainSessionEvents(session)
    expectEventTypes(postKexEvents, ['keys-established', 'outbound-data'])
    const newKeysPacket = (postKexEvents[1] as Extract<SshEvent, { type: 'outbound-data' }>).payload
    const newKeysPayload = unwrapPayload(newKeysPacket)
    expect(newKeysPayload[0]).toBe(SSH_MSG_NEWKEYS)

    session.receive(buildNewKeysPacket())
    await session.waitForIdle()
    drainSessionEvents(session)

    const clientPrivate = clampScalar(CURVE25519_CLIENT_SCALAR)
    const sharedSecretBytes = scalarMult(clientPrivate, CURVE25519_SERVER_PUBLIC)
    const sharedSecretBigInt = littleEndianToBigInt(sharedSecretBytes)
    const sharedSecretField = encodeMpintField(sharedSecretBigInt)

    const clientIdentification = asciiEncoder.encode('SSH-2.0-mana-ssh-web_0.1')
    const serverIdentificationBare = asciiEncoder.encode('SSH-2.0-OpenSSH_9.6')

    const clientPublicLength = new DataView(
      ecdhPayload.buffer,
      ecdhPayload.byteOffset + 1,
      4,
    ).getUint32(0, false)
    const clientPublic = ecdhPayload.slice(5, 5 + clientPublicLength)
    const serverPublic = CURVE25519_SERVER_PUBLIC

    const clientField = encodeStringField(clientPublic)
    const serverField = encodeStringField(serverPublic)

    const hashInput = concatUint8Arrays(
      clientIdentification,
      serverIdentificationBare,
      clientKexPayload,
      serverKexPayload,
      encodeStringField(serverHostKey),
      clientField,
      serverField,
      sharedSecretField,
    )

    const exchangeHashBuffer = await globalThis.crypto!.subtle.digest(
      'SHA-256',
      toDigestBuffer(hashInput),
    )
    const exchangeHash = new Uint8Array(exchangeHashBuffer)

    const sessionId = exchangeHash
    const s2cInitialIv = await deriveKeyMaterial({
      crypto: globalThis.crypto!,
      hashAlgorithm: 'SHA-256',
      sharedSecret: sharedSecretField,
      exchangeHash,
      sessionId,
      letter: 'B'.charCodeAt(0),
      length: 12,
    })
    const s2cKeyMaterial = await deriveKeyMaterial({
      crypto: globalThis.crypto!,
      hashAlgorithm: 'SHA-256',
      sharedSecret: sharedSecretField,
      exchangeHash,
      sessionId,
      letter: 'D'.charCodeAt(0),
      length: 16,
    })
    const { fixed: s2cFixedIv, invocation: s2cInvocation } = splitInitialIv(s2cInitialIv)
    const s2cKey = await importAesGcmKey(globalThis.crypto!, s2cKeyMaterial)

    const serverCipherState = {
      algorithm: 'aes128-gcm@openssh.com' as const,
      key: s2cKey,
      fixedIv: s2cFixedIv,
      invocationCounter: s2cInvocation,
      sequenceNumber: 0,
    }

    const messagePayload = new Uint8Array([0x2f]) // SSH message number 47 (SSH_MSG_USERAUTH_BANNER placeholder)
    const blockSize = 16
    let paddingLength = AES_MIN_PADDING
    const baseLength = messagePayload.length + 1
    while ((baseLength + paddingLength) % blockSize !== 0) {
      paddingLength += 1
    }
    const padding = Uint8Array.from({ length: paddingLength }, (_value, index) => index)
    const packetLength = baseLength + paddingLength
    const plaintext = new Uint8Array(packetLength)
    plaintext[0] = paddingLength
    plaintext.set(messagePayload, 1)
    plaintext.set(padding, 1 + messagePayload.length)
    const additionalData = new Uint8Array(4)
    new DataView(additionalData.buffer).setUint32(0, packetLength, false)

    const { ciphertext } = await encryptAesGcm({
      crypto: globalThis.crypto!,
      state: serverCipherState,
      plaintext,
      additionalData,
    })

    const aesPacket = new Uint8Array(4 + ciphertext.length)
    aesPacket.set(additionalData, 0)
    aesPacket.set(ciphertext, 4)

    session.receive(aesPacket)
    await session.waitForIdle()
    const finalEvents = drainSessionEvents(session)
    expect(finalEvents.some((event) => event.type === 'warning')).toBe(true)
    const warning = finalEvents.find((event) => event.type === 'warning')
    expect(warning).toBeDefined()
    if (warning?.type === 'warning') {
      expect(warning.code, JSON.stringify(warning.detail)).toBe('unsupported-message')
    }
  })
})
