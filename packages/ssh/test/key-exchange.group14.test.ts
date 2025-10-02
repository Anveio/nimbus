import { describe, expect, test, vi } from 'vitest'

import type { AlgorithmCatalog, HostKeyDecision, SshEvent } from '../src/api'
import { createClientSession } from '../src/api'
import {
  asAlgorithmName,
  RecordingHostKeyStore,
  buildClientKexInitPayload,
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

const SSH_MSG_KEXDH_INIT = 30
const SSH_MSG_KEXDH_REPLY = 31
const SSH_MSG_NEWKEYS = 21

function buildNewKeysPacket(): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint8(SSH_MSG_NEWKEYS)
  return wrapSshPacket(writer.toUint8Array())
}

const DH_GROUP14_PRIME_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF'
const DH_GROUP14_PRIME = BigInt(`0x${DH_GROUP14_PRIME_HEX}`)
const DH_GROUP14_GENERATOR = 2n

const CLIENT_EXPONENT_BYTES = hexToUint8Array(
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
)
const SERVER_EXPONENT_BYTES = hexToUint8Array(
  '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100',
)

const CLIENT_EXPONENT = bytesToBigInt(CLIENT_EXPONENT_BYTES)
const NORMALIZED_CLIENT_EXPONENT = normalizeExponent(CLIENT_EXPONENT)
const SERVER_EXPONENT = bytesToBigInt(SERVER_EXPONENT_BYTES)
const NORMALIZED_SERVER_EXPONENT = normalizeExponent(SERVER_EXPONENT)

const CLIENT_PUBLIC = modPow(DH_GROUP14_GENERATOR, NORMALIZED_CLIENT_EXPONENT, DH_GROUP14_PRIME)
const SERVER_PUBLIC = modPow(DH_GROUP14_GENERATOR, NORMALIZED_SERVER_EXPONENT, DH_GROUP14_PRIME)
const SHARED_SECRET = modPow(SERVER_PUBLIC, NORMALIZED_CLIENT_EXPONENT, DH_GROUP14_PRIME)

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  if (hex.length === 0) {
    return 0n
  }
  return BigInt(`0x${hex}`)
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) {
    return 0n
  }
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus
    }
    e >>= 1n
    b = (b * b) % modulus
  }
  return result
}

function normalizeExponent(value: bigint): bigint {
  const modulus = DH_GROUP14_PRIME - 2n
  return (value % modulus) + 2n
}

function buildDhReplyPacket(): Uint8Array {
  const payloadWriter = new BinaryWriter()
  payloadWriter.writeUint8(SSH_MSG_KEXDH_REPLY)
  const hostKey = buildEd25519HostKeyBlob()
  payloadWriter.writeUint32(hostKey.length)
  payloadWriter.writeBytes(hostKey)
  payloadWriter.writeMpint(SERVER_PUBLIC)
  const signature = buildEd25519Signature()
  payloadWriter.writeUint32(signature.length)
  payloadWriter.writeBytes(signature)
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

describe('RFC 4419 §3 diffie-hellman-group14-sha256 key exchange', () => {
  test('negotiates group14 fallback and emits NEWKEYS after shared secret derivation', async () => {
    expect(SHARED_SECRET).toBeGreaterThan(0n)

    const decision: HostKeyDecision = { outcome: 'trusted', source: 'known-hosts' }
    const hostKeys = new RecordingHostKeyStore(decision)

    const randomBytes = vi.fn((length: number) => {
      if (length === 16) {
        return new Uint8Array(16)
      }
      if (length === CLIENT_EXPONENT_BYTES.length) {
        return CLIENT_EXPONENT_BYTES
      }
      return new Uint8Array(length)
    })

    const algorithms = {
      keyExchange: [
        asAlgorithmName('curve25519-sha256@libssh.org'),
        asAlgorithmName('diffie-hellman-group14-sha256'),
      ],
      hostKeys: [asAlgorithmName('ssh-ed25519')],
      ciphers: [asAlgorithmName('aes128-gcm@openssh.com')],
      macs: [asAlgorithmName('AEAD_AES_128_GCM')],
      compression: [asAlgorithmName('none')],
      extensions: [],
    } satisfies AlgorithmCatalog

    const session = createClientSession(
      createTestClientConfig({
        hostKeys,
        randomBytes,
        algorithms,
        crypto: createBypassSignatureCrypto(),
      }),
    )

    // drain initial outbound payloads
    session.nextEvent()
    session.nextEvent()
    session.flushOutbound()

    const serverId = encodeIdentificationLine('SSH-2.0-Server_Group14')
    const serverKex = buildServerKexInitPacket({
      kexAlgorithms: ['diffie-hellman-group14-sha256'],
      hostKeys: ['ssh-ed25519'],
      encryptionClientToServer: ['aes128-gcm@openssh.com'],
      encryptionServerToClient: ['aes128-gcm@openssh.com'],
      macClientToServer: ['AEAD_AES_128_GCM'],
      macServerToClient: ['AEAD_AES_128_GCM'],
      compressionClientToServer: ['none'],
      compressionServerToClient: ['none'],
    })

    const combined = new Uint8Array(serverId.length + serverKex.length)
    combined.set(serverId)
    combined.set(serverKex, serverId.length)

    session.receive(combined)
    await session.waitForIdle()
    await session.waitForIdle()

    const negotiationEvents = drainSessionEvents(session)
    expectEventTypes(negotiationEvents, [
      'identification-received',
      'kex-init-sent',
      'kex-init-received',
      'outbound-data',
      'outbound-data',
    ])

    const outboundPackets = session.flushOutbound()
    expect(outboundPackets).toHaveLength(2)
    const [clientKexPacket, dhInitPacket] = outboundPackets
    const expectedClientKexPayload = buildClientKexInitPayload(algorithms, randomBytes)
    const clientPayload = unwrapPayload(clientKexPacket!)
    expect(clientPayload).toEqual(expectedClientKexPayload)
    const dhInitPayload = unwrapPayload(dhInitPacket!)
    expect(dhInitPayload[0]).toBe(SSH_MSG_KEXDH_INIT)
    const reader = new BinaryReader(dhInitPayload)
    reader.readUint8()
    const eValue = reader.readMpint()
    expect(eValue).toBe(CLIENT_PUBLIC)

    session.receive(buildDhReplyPacket())
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
})
