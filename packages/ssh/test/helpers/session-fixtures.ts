import { webcrypto as nodeCrypto } from 'node:crypto'
import type {
  AlgorithmCatalog,
  AlgorithmName,
  DiagnosticRecord,
  DiagnosticsSink,
  HostKeyCandidate,
  HostKeyDecision,
  HostKeyStore,
  IdentificationConfig,
  SshClientConfig,
  SshEvent,
  SshSession,
} from '../../src/api'

import { BinaryWriter } from '../../src/internal/binary/binary-writer'
import { encodeMpint as encodeMpintInternal } from '../../src/internal/binary/mpint'

const ASCII_ENCODER = new TextEncoder()
const MIN_PADDING_LENGTH = 4
const SSH_PACKET_BLOCK_SIZE = 8
const SSH_MSG_KEXINIT = 20

export const asAlgorithmName = (value: string): AlgorithmName =>
  value as AlgorithmName

export const TEST_ALGORITHMS: AlgorithmCatalog = {
  keyExchange: [
    asAlgorithmName('curve25519-sha256@libssh.org'),
    asAlgorithmName('diffie-hellman-group14-sha256'),
  ],
  ciphers: [asAlgorithmName('aes128-gcm@openssh.com')],
  macs: [asAlgorithmName('AEAD_AES_128_GCM'), asAlgorithmName('hmac-sha2-256')],
  hostKeys: [asAlgorithmName('ssh-ed25519'), asAlgorithmName('rsa-sha2-256')],
  compression: [asAlgorithmName('none')],
  extensions: [asAlgorithmName('ext-info-c')],
}

const DEFAULT_IDENTIFICATION: IdentificationConfig = {
  clientId: 'SSH-2.0-mana-ssh-web_0.1',
}

const UNKNOWN_DECISION: HostKeyDecision = { outcome: 'unknown' as const }

class EphemeralHostKeyStore implements HostKeyStore {
  async evaluate(): Promise<HostKeyDecision> {
    return UNKNOWN_DECISION
  }
}

export class RecordingHostKeyStore implements HostKeyStore {
  readonly evaluations: HostKeyCandidate[] = []
  readonly remembers: HostKeyCandidate[] = []
  #decision: HostKeyDecision

  constructor(
    decision: HostKeyDecision = { outcome: 'trusted', source: 'known-hosts' },
  ) {
    this.#decision = decision
  }

  async evaluate(candidate: HostKeyCandidate): Promise<HostKeyDecision> {
    this.evaluations.push(candidate)
    return this.#decision
  }

  async remember(
    candidate: HostKeyCandidate,
    _decision: HostKeyDecision,
  ): Promise<void> {
    this.remembers.push(candidate)
  }
}

export class CollectingDiagnostics implements DiagnosticsSink {
  readonly records: DiagnosticRecord[] = []

  onRecord(record: DiagnosticRecord): void {
    this.records.push(record)
  }
}

class NullDiagnostics implements DiagnosticsSink {
  onRecord(): void {
    // intentional no-op for tests that do not inspect diagnostics
  }
}

const zeroRandomBytes = (length: number): Uint8Array => new Uint8Array(length)

const fixedClock = (): number => 0

export function createTestClientConfig(
  overrides: Partial<SshClientConfig> = {},
): SshClientConfig {
  const config: Mutable<SshClientConfig> = {
    clock: overrides.clock ?? fixedClock,
    randomBytes: overrides.randomBytes ?? zeroRandomBytes,
    identification: overrides.identification ?? DEFAULT_IDENTIFICATION,
    algorithms: overrides.algorithms ?? TEST_ALGORITHMS,
    hostKeys: overrides.hostKeys ?? new EphemeralHostKeyStore(),
    hostIdentity: overrides.hostIdentity ?? { host: 'test.example', port: 22 },
  }

  if (overrides.auth) {
    config.auth = overrides.auth
  }
  if (overrides.channels) {
    config.channels = overrides.channels
  }
  if (overrides.diagnostics) {
    config.diagnostics = overrides.diagnostics
  } else if (overrides.diagnostics !== null) {
    config.diagnostics = new NullDiagnostics()
  }
  if (overrides.guards) {
    config.guards = overrides.guards
  }
  config.crypto = overrides.crypto ?? globalThis.crypto

  return config
}

export function encodeIdentificationLine(line: string): Uint8Array {
  if (!line.startsWith('SSH-')) {
    throw new Error('Identification lines must begin with "SSH-"')
  }
  const normalized = line.endsWith('\n')
    ? line
    : line.endsWith('\r')
      ? `${line}\n`
      : `${line}\r\n`
  return ASCII_ENCODER.encode(normalized)
}

export interface ServerKexInitOptions {
  readonly kexAlgorithms?: ReadonlyArray<string>
  readonly hostKeys?: ReadonlyArray<string>
  readonly encryptionClientToServer?: ReadonlyArray<string>
  readonly encryptionServerToClient?: ReadonlyArray<string>
  readonly macClientToServer?: ReadonlyArray<string>
  readonly macServerToClient?: ReadonlyArray<string>
  readonly compressionClientToServer?: ReadonlyArray<string>
  readonly compressionServerToClient?: ReadonlyArray<string>
  readonly languagesClientToServer?: ReadonlyArray<string>
  readonly languagesServerToClient?: ReadonlyArray<string>
  readonly firstKexPacketFollows?: boolean
  readonly reserved?: number
  readonly paddingLength?: number
}

const DEFAULT_SERVER_KEX_OPTIONS: Required<
  Omit<ServerKexInitOptions, 'reserved' | 'paddingLength'>
> & {
  readonly reserved: number
  readonly paddingLength: number
} = {
  kexAlgorithms: ['curve25519-sha256@libssh.org'],
  hostKeys: ['ssh-ed25519'],
  encryptionClientToServer: ['aes128-gcm@openssh.com'],
  encryptionServerToClient: ['aes128-gcm@openssh.com'],
  macClientToServer: ['AEAD_AES_128_GCM'],
  macServerToClient: ['AEAD_AES_128_GCM'],
  compressionClientToServer: ['none'],
  compressionServerToClient: ['none'],
  languagesClientToServer: [],
  languagesServerToClient: [],
  firstKexPacketFollows: false,
  reserved: 0,
  paddingLength: 4,
}

export function buildServerKexInitPacket(
  options: ServerKexInitOptions = {},
): Uint8Array {
  const merged = {
    ...DEFAULT_SERVER_KEX_OPTIONS,
    ...options,
  }

  const writer = new BinaryWriter()
  writer.writeUint8(20)
  writer.writeBytes(new Uint8Array(16))
  writer.writeNameList([...merged.kexAlgorithms])
  writer.writeNameList([...merged.hostKeys])
  writer.writeNameList([...merged.encryptionClientToServer])
  writer.writeNameList([...merged.encryptionServerToClient])
  writer.writeNameList([...merged.macClientToServer])
  writer.writeNameList([...merged.macServerToClient])
  writer.writeNameList([...merged.compressionClientToServer])
  writer.writeNameList([...merged.compressionServerToClient])
  writer.writeNameList([...merged.languagesClientToServer])
  writer.writeNameList([...merged.languagesServerToClient])
  writer.writeBoolean(merged.firstKexPacketFollows)
  writer.writeUint32(merged.reserved)
  const payload = writer.toUint8Array()

  const paddingLength = options.paddingLength ?? merged.paddingLength
  const packetLength = payload.length + paddingLength + 1
  const outer = new BinaryWriter()
  outer.writeUint32(packetLength)
  outer.writeUint8(paddingLength)
  outer.writeBytes(payload)
  const padding = Uint8Array.from(
    { length: paddingLength },
    (_, index) => index + 1,
  )
  outer.writeBytes(padding)
  return outer.toUint8Array()
}

export function buildClientKexInitPayload(
  algorithms: AlgorithmCatalog,
  randomBytes: (length: number) => Uint8Array,
): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint8(SSH_MSG_KEXINIT)
  writer.writeBytes(randomBytes(16))
  const kexAlgorithms = [
    ...algorithms.keyExchange.map((value) => value as string),
    ...(algorithms.extensions?.map((value) => value as string) ?? []),
  ]
  writer.writeNameList(kexAlgorithms)
  writer.writeNameList(algorithms.hostKeys.map((value) => value as string))
  writer.writeNameList(algorithms.ciphers.map((value) => value as string))
  writer.writeNameList(algorithms.ciphers.map((value) => value as string))
  writer.writeNameList(algorithms.macs.map((value) => value as string))
  writer.writeNameList(algorithms.macs.map((value) => value as string))
  writer.writeNameList(algorithms.compression.map((value) => value as string))
  writer.writeNameList(algorithms.compression.map((value) => value as string))
  writer.writeNameList([])
  writer.writeNameList([])
  writer.writeBoolean(false)
  writer.writeUint32(0)
  return writer.toUint8Array()
}

export function drainSessionEvents(session: SshSession): SshEvent[] {
  const events: SshEvent[] = []
  let event: SshEvent | undefined
  // eslint-disable-next-line no-cond-assign
  while ((event = session.nextEvent())) {
    events.push(event)
  }
  return events
}

export function wrapSshPacket(
  payload: Uint8Array,
  randomBytes: (length: number) => Uint8Array = zeroRandomBytes,
): Uint8Array {
  let paddingLength = MIN_PADDING_LENGTH
  while ((payload.length + paddingLength + 1) % SSH_PACKET_BLOCK_SIZE !== 0) {
    paddingLength += 1
  }
  if (paddingLength > 255) {
    throw new Error('Padding length overflow when wrapping SSH packet')
  }

  const packetLength = payload.length + paddingLength + 1
  const writer = new BinaryWriter()
  writer.writeUint32(packetLength)
  writer.writeUint8(paddingLength)
  writer.writeBytes(payload)
  writer.writeBytes(randomBytes(paddingLength))
  return writer.toUint8Array()
}

export function hexToUint8Array(hex: string): Uint8Array {
  const normalized = hex.replace(/\s+/g, '')
  if (normalized.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters')
  }
  const result = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < normalized.length; i += 2) {
    result[i / 2] = parseInt(normalized.slice(i, i + 2), 16)
  }
  return result
}

export function encodeMpint(value: bigint): Uint8Array {
  return encodeMpintInternal(value)
}

export function createBypassSignatureCrypto(): Crypto {
  const subtle = nodeCrypto.subtle
  const stubbedSubtle = {
    digest: subtle.digest.bind(subtle),
    importKey: subtle.importKey.bind(subtle),
    encrypt: subtle.encrypt.bind(subtle),
    decrypt: subtle.decrypt.bind(subtle),
    verify: async () => true,
  } as unknown as SubtleCrypto
  const getRandomValues = <T extends ArrayBufferView>(array: T): T =>
    nodeCrypto.getRandomValues(array as any) as T
  const randomUUID = nodeCrypto.randomUUID?.bind(nodeCrypto)
  const cryptoProvider = {
    getRandomValues,
    randomUUID,
    subtle: stubbedSubtle,
  } satisfies Partial<Crypto>
  return cryptoProvider as Crypto
}

const ED25519_HOST_PUBLIC_KEY_HEX =
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
const ED25519_PLACEHOLDER_SIGNATURE_HEX =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555e6f848c0b662421c8fe0d4d3d8fd0f3ca1e9a66d62d0fce7f1366b2be7b9fdb'

export const ED25519_HOST_PUBLIC_KEY = hexToUint8Array(
  ED25519_HOST_PUBLIC_KEY_HEX,
)
const ED25519_PLACEHOLDER_SIGNATURE = hexToUint8Array(
  ED25519_PLACEHOLDER_SIGNATURE_HEX,
)

export function buildEd25519HostKeyBlob(): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeString('ssh-ed25519')
  writer.writeUint32(ED25519_HOST_PUBLIC_KEY.length)
  writer.writeBytes(ED25519_HOST_PUBLIC_KEY)
  return writer.toUint8Array()
}

export function buildEd25519Signature(): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeString('ssh-ed25519')
  writer.writeUint32(ED25519_PLACEHOLDER_SIGNATURE.length)
  writer.writeBytes(ED25519_PLACEHOLDER_SIGNATURE)
  return writer.toUint8Array()
}
