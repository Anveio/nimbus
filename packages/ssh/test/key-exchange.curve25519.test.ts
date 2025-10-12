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
  decryptAesGcm,
  encryptAesGcm,
  importAesGcmKey,
  splitInitialIv,
} from '../src/internal/crypto/aes-gcm'
import {
  clampScalar,
  scalarMult,
  scalarMultBase,
} from '../src/internal/crypto/x25519'

const SSH_MSG_KEX_ECDH_INIT = 30
const SSH_MSG_KEX_ECDH_REPLY = 31
const SSH_MSG_NEWKEYS = 21
const SSH_MSG_CHANNEL_OPEN = 90
const SSH_MSG_CHANNEL_OPEN_CONFIRMATION = 91
const SSH_MSG_CHANNEL_DATA = 94
const SSH_MSG_CHANNEL_REQUEST = 98
const SSH_MSG_CHANNEL_EOF = 96
const SSH_MSG_CHANNEL_CLOSE = 97
const SSH_MSG_CHANNEL_SUCCESS = 99
const SSH_MSG_CHANNEL_FAILURE = 100

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

function expectEventTypes(
  events: ReadonlyArray<SshEvent>,
  expected: ReadonlyArray<SshEvent['type']>,
): void {
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
    const decision: HostKeyDecision = {
      outcome: 'trusted',
      source: 'known-hosts',
    }
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
        guards: { disableAutoUserAuth: true },
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

    const combined = new Uint8Array(
      serverIdentification.length + serverKexInit.length,
    )
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
      'client-public-key-ready',
      'outbound-data',
    ])

    const expectedClientKexPayload = buildClientKexInitPayload(
      TEST_ALGORITHMS,
      randomBytes,
    )
    const outboundAfterNegotiation = session.flushOutbound()
    expect(outboundAfterNegotiation).toHaveLength(2)

    const [clientKexPacket, ecdhInitPacket] = outboundAfterNegotiation as [
      Uint8Array,
      Uint8Array,
    ]
    const clientKexPayload = unwrapPayload(clientKexPacket!)
    const ecdhInitPayload = unwrapPayload(ecdhInitPacket!)
    expect(clientKexPayload).toEqual(expectedClientKexPayload)
    expect(ecdhInitPayload[0]).toBe(SSH_MSG_KEX_ECDH_INIT)
    const publicKeyLength = new DataView(
      ecdhInitPayload.buffer,
      ecdhInitPayload.byteOffset + 1,
      4,
    ).getUint32(0, false)
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

  test('handles channel lifecycle over AES-GCM after NEWKEYS', async () => {
    const hostKeys = new RecordingHostKeyStore({
      outcome: 'trusted',
      source: 'known-hosts',
    })

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
        guards: { disableAutoUserAuth: true },
      }),
    )

    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverIdentification = encodeIdentificationLine('SSH-2.0-OpenSSH_9.6')
    const serverKexInitPacket = buildServerKexInitPacket()
    const combined = new Uint8Array(
      serverIdentification.length + serverKexInitPacket.length,
    )
    combined.set(serverIdentification)
    combined.set(serverKexInitPacket, serverIdentification.length)

    session.receive(combined)
    await session.waitForIdle()
    await session.waitForIdle()

    const negotiationEvents = drainSessionEvents(session)
    expectEventTypes(negotiationEvents, [
      'identification-received',
      'kex-init-sent',
      'kex-init-received',
      'outbound-data',
      'client-public-key-ready',
      'outbound-data',
    ])
    const expectedClientKexPayload = buildClientKexInitPayload(
      TEST_ALGORITHMS,
      randomBytes,
    )
    const outboundPackets = session.flushOutbound()
    expect(outboundPackets).toHaveLength(2)
    const [clientKexPacket, ecdhInitPacket] = outboundPackets as [
      Uint8Array,
      Uint8Array,
    ]
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
    const outboundAfterReply = session.flushOutbound()
    expect(outboundAfterReply).toHaveLength(1)
    const newKeysPayload = unwrapPayload(outboundAfterReply[0]!)
    expect(newKeysPayload[0]).toBe(SSH_MSG_NEWKEYS)

    session.receive(buildNewKeysPacket())
    await session.waitForIdle()
    expect(session.inspect().phase).toBe('authenticated')
    drainSessionEvents(session)

    const clientPrivate = clampScalar(CURVE25519_CLIENT_SCALAR)
    const sharedSecretBytes = scalarMult(
      clientPrivate,
      CURVE25519_SERVER_PUBLIC,
    )
    const sharedSecretBigInt = littleEndianToBigInt(sharedSecretBytes)
    const sharedSecretField = encodeMpintField(sharedSecretBigInt)

    const clientIdentification = asciiEncoder.encode('SSH-2.0-nimbus-ssh-web_0.1')
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
    const { fixed: s2cFixedIv, invocation: s2cInvocation } =
      splitInitialIv(s2cInitialIv)
    const s2cKey = await importAesGcmKey(globalThis.crypto!, s2cKeyMaterial)

    const c2sInitialIv = await deriveKeyMaterial({
      crypto: globalThis.crypto!,
      hashAlgorithm: 'SHA-256',
      sharedSecret: sharedSecretField,
      exchangeHash,
      sessionId,
      letter: 'A'.charCodeAt(0),
      length: 12,
    })
    const c2sKeyMaterial = await deriveKeyMaterial({
      crypto: globalThis.crypto!,
      hashAlgorithm: 'SHA-256',
      sharedSecret: sharedSecretField,
      exchangeHash,
      sessionId,
      letter: 'C'.charCodeAt(0),
      length: 16,
    })
    const { fixed: c2sFixedIv, invocation: c2sInvocation } =
      splitInitialIv(c2sInitialIv)
    const c2sKey = await importAesGcmKey(globalThis.crypto!, c2sKeyMaterial)

    const clientCipherState = {
      algorithm: 'aes128-gcm@openssh.com' as const,
      key: c2sKey,
      fixedIv: c2sFixedIv,
      invocationCounter: c2sInvocation,
      sequenceNumber: 0,
    }

    const decryptClientPacket = async (packet: Uint8Array) => {
      const additionalData = packet.slice(0, 4)
      const packetLength = new DataView(
        additionalData.buffer,
        additionalData.byteOffset,
        4,
      ).getUint32(0, false)
      const encrypted = packet.slice(4)
      const plaintext = await decryptAesGcm({
        crypto: globalThis.crypto!,
        state: clientCipherState,
        packetLength,
        encrypted,
        additionalData,
      })
      const paddingLength = plaintext[0]!
      const payloadLength = packetLength - paddingLength - 1
      return plaintext.slice(1, 1 + payloadLength)
    }

    const serverCipherState = {
      algorithm: 'aes128-gcm@openssh.com' as const,
      key: s2cKey,
      fixedIv: s2cFixedIv,
      invocationCounter: s2cInvocation,
      sequenceNumber: 0,
    }

    const encryptServerPacket = async (payload: Uint8Array) => {
      let paddingLength = AES_MIN_PADDING
      const baseLength = payload.length + 1
      while ((baseLength + paddingLength) % 16 !== 0) {
        paddingLength += 1
      }
      const padding = Uint8Array.from(
        { length: paddingLength },
        (_value, index) => index,
      )
      const packetLength = baseLength + paddingLength
      const plaintext = new Uint8Array(packetLength)
      plaintext[0] = paddingLength
      plaintext.set(payload, 1)
      plaintext.set(padding, 1 + payload.length)
      const additionalData = new Uint8Array(4)
      new DataView(additionalData.buffer).setUint32(0, packetLength, false)
      const { ciphertext } = await encryptAesGcm({
        crypto: globalThis.crypto!,
        state: serverCipherState,
        plaintext,
        additionalData,
      })
      const packet = new Uint8Array(4 + ciphertext.length)
      packet.set(additionalData, 0)
      packet.set(ciphertext, 4)
      return packet
    }

    session.command({ type: 'open-channel', request: { type: 'session' } })
    await session.waitForIdle()

    const outboundAfterCommand = drainSessionEvents(session)
    expectEventTypes(outboundAfterCommand, ['outbound-data'])
    const channelOpenPackets = session.flushOutbound()
    expect(channelOpenPackets).toHaveLength(1)
    const channelOpenPayload = await decryptClientPacket(channelOpenPackets[0]!)
    expect(channelOpenPayload[0]).toBe(SSH_MSG_CHANNEL_OPEN)

    const channelsAfterCommand = session.inspect().openChannels
    expect(channelsAfterCommand).toHaveLength(1)
    const openingSnapshot = channelsAfterCommand[0]!
    expect(openingSnapshot.status).toBe('opening')
    const localChannelId = openingSnapshot.localId

    const confirmationWriter = new BinaryWriter()
    confirmationWriter.writeUint8(SSH_MSG_CHANNEL_OPEN_CONFIRMATION)
    confirmationWriter.writeUint32(Number(localChannelId))
    const remoteChannelId = 42
    confirmationWriter.writeUint32(remoteChannelId)
    const remoteWindow = 65536
    const remoteMaxPacket = 32768
    confirmationWriter.writeUint32(remoteWindow)
    confirmationWriter.writeUint32(remoteMaxPacket)
    const confirmationPacket = await encryptServerPacket(
      confirmationWriter.toUint8Array(),
    )
    session.receive(confirmationPacket)
    await session.waitForIdle()
    const confirmationEvents = drainSessionEvents(session)
    expectEventTypes(confirmationEvents, ['channel-open'])

    const ptyRequest = {
      type: 'pty-req',
      columns: 80,
      rows: 24,
      widthPixels: 640,
      heightPixels: 480,
    } as const

    session.command({
      type: 'request-channel',
      channelId: localChannelId,
      request: ptyRequest,
    })
    await session.waitForIdle()
    const ptyOutboundEvents = drainSessionEvents(session)
    expectEventTypes(ptyOutboundEvents, ['outbound-data'])
    const ptyPackets = session.flushOutbound()
    expect(ptyPackets).toHaveLength(1)
    const ptyPayload = await decryptClientPacket(ptyPackets[0]!)
    const ptyReader = new BinaryReader(ptyPayload)
    expect(ptyReader.readUint8()).toBe(SSH_MSG_CHANNEL_REQUEST)
    expect(ptyReader.readUint32()).toBe(remoteChannelId)
    expect(ptyReader.readString()).toBe('pty-req')
    expect(ptyReader.readBoolean()).toBe(true)
    expect(ptyReader.readString()).toBe('xterm-256color')
    expect(ptyReader.readUint32()).toBe(80)
    expect(ptyReader.readUint32()).toBe(24)
    expect(ptyReader.readUint32()).toBe(640)
    expect(ptyReader.readUint32()).toBe(480)
    const modesLength = ptyReader.readUint32()
    const modes = ptyReader.readBytes(modesLength)
    expect(modes.length).toBeGreaterThan(0)
    expect(modes[modes.length - 1]).toBe(0)

    const successWriter = new BinaryWriter()
    successWriter.writeUint8(SSH_MSG_CHANNEL_SUCCESS)
    successWriter.writeUint32(Number(localChannelId))
    const successPacket = await encryptServerPacket(
      successWriter.toUint8Array(),
    )
    session.receive(successPacket)
    await session.waitForIdle()
    const ptySuccessEvents = drainSessionEvents(session)
    expectEventTypes(ptySuccessEvents, ['channel-request'])
    const ptyEvent = ptySuccessEvents[0] as Extract<
      SshEvent,
      { type: 'channel-request' }
    >
    expect(ptyEvent.status).toBe('success')
    expect(ptyEvent.requestType).toBe('pty-req')
    expect(ptyEvent.request).toEqual(ptyRequest)

    const execRequest = {
      type: 'exec',
      command: 'uptime',
    } as const
    session.command({
      type: 'request-channel',
      channelId: localChannelId,
      request: execRequest,
    })
    await session.waitForIdle()
    const execOutboundEvents = drainSessionEvents(session)
    expectEventTypes(execOutboundEvents, ['outbound-data'])
    const execPackets = session.flushOutbound()
    expect(execPackets).toHaveLength(1)
    const execPayload = await decryptClientPacket(execPackets[0]!)
    const execReader = new BinaryReader(execPayload)
    expect(execReader.readUint8()).toBe(SSH_MSG_CHANNEL_REQUEST)
    expect(execReader.readUint32()).toBe(remoteChannelId)
    expect(execReader.readString()).toBe('exec')
    expect(execReader.readBoolean()).toBe(true)
    expect(execReader.readString()).toBe('uptime')

    const failureWriter = new BinaryWriter()
    failureWriter.writeUint8(SSH_MSG_CHANNEL_FAILURE)
    failureWriter.writeUint32(Number(localChannelId))
    const failurePacket = await encryptServerPacket(
      failureWriter.toUint8Array(),
    )
    session.receive(failurePacket)
    await session.waitForIdle()
    const execFailureEvents = drainSessionEvents(session)
    expectEventTypes(execFailureEvents, ['channel-request'])
    const execEvent = execFailureEvents[0] as Extract<
      SshEvent,
      { type: 'channel-request' }
    >
    expect(execEvent.status).toBe('failure')
    expect(execEvent.requestType).toBe('exec')
    expect(execEvent.request).toEqual(execRequest)

    const exitSignalWriter = new BinaryWriter()
    exitSignalWriter.writeUint8(SSH_MSG_CHANNEL_REQUEST)
    exitSignalWriter.writeUint32(Number(localChannelId))
    exitSignalWriter.writeString('exit-signal')
    exitSignalWriter.writeBoolean(false)
    exitSignalWriter.writeString('TERM')
    exitSignalWriter.writeBoolean(false)
    exitSignalWriter.writeString('Terminated by signal')
    exitSignalWriter.writeString('en-US')
    const exitSignalPacket = await encryptServerPacket(
      exitSignalWriter.toUint8Array(),
    )
    session.receive(exitSignalPacket)
    await session.waitForIdle()
    const exitSignalEvents = drainSessionEvents(session)
    expectEventTypes(exitSignalEvents, ['channel-exit-signal'])
    const exitSignalEvent = exitSignalEvents[0] as Extract<
      SshEvent,
      { type: 'channel-exit-signal' }
    >
    expect(exitSignalEvent.signal).toBe('TERM')
    expect(exitSignalEvent.coreDumped).toBe(false)
    expect(exitSignalEvent.errorMessage).toBe('Terminated by signal')
    expect(exitSignalEvent.language).toBe('en-US')

    const dataWriter = new BinaryWriter()
    dataWriter.writeUint8(SSH_MSG_CHANNEL_DATA)
    dataWriter.writeUint32(Number(localChannelId))
    const payloadBytes = new TextEncoder().encode('hello')
    dataWriter.writeUint32(payloadBytes.length)
    dataWriter.writeBytes(payloadBytes)
    const dataPacket = await encryptServerPacket(dataWriter.toUint8Array())
    session.receive(dataPacket)
    await session.waitForIdle()
    const dataEvents = drainSessionEvents(session)
    expectEventTypes(dataEvents, ['channel-data'])
    const channelDataEvent = dataEvents[0] as Extract<
      SshEvent,
      { type: 'channel-data' }
    >
    expect(new TextDecoder().decode(channelDataEvent.data)).toBe('hello')

    const exitRequestWriter = new BinaryWriter()
    exitRequestWriter.writeUint8(SSH_MSG_CHANNEL_REQUEST)
    exitRequestWriter.writeUint32(Number(localChannelId))
    exitRequestWriter.writeString('exit-status')
    exitRequestWriter.writeBoolean(false)
    exitRequestWriter.writeUint32(0)
    const exitPacket = await encryptServerPacket(
      exitRequestWriter.toUint8Array(),
    )
    session.receive(exitPacket)
    await session.waitForIdle()
    const exitEvents = drainSessionEvents(session)
    expectEventTypes(exitEvents, ['channel-exit-status'])
    const exitStatusEvent = exitEvents[0] as Extract<
      SshEvent,
      { type: 'channel-exit-status' }
    >
    expect(exitStatusEvent.exitStatus).toBe(0)

    const eofWriter = new BinaryWriter()
    eofWriter.writeUint8(SSH_MSG_CHANNEL_EOF)
    eofWriter.writeUint32(Number(localChannelId))
    const eofPacket = await encryptServerPacket(eofWriter.toUint8Array())
    session.receive(eofPacket)
    await session.waitForIdle()
    const eofEvents = drainSessionEvents(session)
    expectEventTypes(eofEvents, ['channel-eof'])

    const closeWriter = new BinaryWriter()
    closeWriter.writeUint8(SSH_MSG_CHANNEL_CLOSE)
    closeWriter.writeUint32(Number(localChannelId))
    const closePacket = await encryptServerPacket(closeWriter.toUint8Array())
    session.receive(closePacket)
    await session.waitForIdle()
    const closeEvents = drainSessionEvents(session)
    expectEventTypes(closeEvents, ['channel-close'])
    const closeEvent = closeEvents[0] as Extract<
      SshEvent,
      { type: 'channel-close' }
    >
    expect(closeEvent.exitStatus).toBe(0)

    const finalChannels = session.inspect().openChannels
    expect(finalChannels).toHaveLength(1)
    const finalSnapshot = finalChannels[0]!
    expect(finalSnapshot.status).toBe('closed')
    expect(finalSnapshot.remoteId).toBe(remoteChannelId)
    expect(finalSnapshot.windowSize).toBe(remoteWindow)
    expect(finalSnapshot.maxPacketSize).toBe(remoteMaxPacket)
    expect(session.inspect().phase).toBe('connected')
  })
})
