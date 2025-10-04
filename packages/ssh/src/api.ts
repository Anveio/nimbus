import {
  SshInvariantViolation,
  SshNotImplementedError,
  SshProtocolError,
} from './errors'
import { AsyncEventQueue } from './internal/async-event-queue'
import { BinaryReader } from './internal/binary/binary-reader'
import { BinaryWriter } from './internal/binary/binary-writer'
import {
  type AesGcmDirectionState,
  decryptAesGcm,
  encryptAesGcm,
  GCM_TAG_LENGTH_BYTES,
  importAesGcmKey,
  splitInitialIv,
} from './internal/crypto/aes-gcm'
import { deriveKeyMaterial, type HashAlgorithm } from './internal/crypto/kdf'
import {
  clampScalar,
  scalarMult,
  scalarMultBase,
} from './internal/crypto/x25519'

export type AlgorithmName = string & { readonly __brand: 'AlgorithmName' }

export type ChannelId = number & { readonly __brand: 'ChannelId' }

export type CipherStateLabel = 'initial' | 'rekey'

export type SessionPhase =
  | 'initial'
  | 'identification'
  | 'negotiating'
  | 'kex'
  | 'authenticated'
  | 'connected'
  | 'closed'
  | 'failed'

export interface IdentificationConfig {
  readonly clientId: string
  readonly banner?: string
}

export interface DiagnosticsSink {
  onRecord(record: DiagnosticRecord): void
}

export interface DiagnosticRecord {
  readonly timestamp: number
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly code: string
  readonly message: string
  readonly detail?: unknown
}

export interface EngineGuards {
  readonly allowSha1Signatures?: boolean
  readonly enableDropbearCompat?: boolean
  readonly maxPayloadBytes?: number
}

export interface HostIdentity {
  readonly host: string
  readonly port: number
}

export interface HostKeyCandidate {
  readonly host: string
  readonly port: number
  readonly keyType: string
  readonly fingerprint: string
  readonly raw: Uint8Array
}

export type HostKeyDecision =
  | {
      readonly outcome: 'trusted'
      readonly source: 'known-hosts' | 'dnssec' | 'pinned'
      readonly comment?: string
    }
  | {
      readonly outcome: 'mismatch'
      readonly severity: 'fatal' | 'warning'
      readonly comment?: string
    }
  | { readonly outcome: 'unknown'; readonly comment?: string }

export interface HostKeyStore {
  evaluate(candidate: HostKeyCandidate): Promise<HostKeyDecision>
  remember?(
    candidate: HostKeyCandidate,
    decision: HostKeyDecision,
  ): Promise<void> | void
}

export interface ChannelPolicy {
  readonly maxConcurrentChannels?: number
  readonly initialWindowSize?: number
  readonly maxPacketSize?: number
  readonly allowSession?: boolean
  readonly allowExec?: boolean
  readonly allowSubsystem?: boolean
  readonly allowAgentForward?: boolean
  readonly allowPortForward?: boolean
  readonly vendorExtensions?: ReadonlyArray<string>
}

export interface AlgorithmCatalog {
  readonly keyExchange: ReadonlyArray<AlgorithmName>
  readonly ciphers: ReadonlyArray<AlgorithmName>
  readonly macs: ReadonlyArray<AlgorithmName>
  readonly hostKeys: ReadonlyArray<AlgorithmName>
  readonly compression: ReadonlyArray<AlgorithmName>
  readonly extensions?: ReadonlyArray<AlgorithmName>
}

export interface AuthPrompt {
  readonly prompt: string
  readonly echo: boolean
  readonly language?: string
}

export interface AuthenticationEventCommon {
  readonly service: string
  readonly username: string
}

export type AuthenticationEvent =
  | (AuthenticationEventCommon & {
      readonly type: 'banner'
      readonly message: string
      readonly language?: string
    })
  | (AuthenticationEventCommon & {
      readonly type: 'methods'
      readonly methods: ReadonlyArray<string>
      readonly partial: boolean
    })
  | (AuthenticationEventCommon & {
      readonly type: 'keyboard-interactive'
      readonly prompts: ReadonlyArray<AuthPrompt>
    })

export interface AuthenticationToolkit {
  issue(intent: ClientIntent): void
}

export interface AuthenticationStrategy {
  onEvent(
    event: AuthenticationEvent,
    toolkit: AuthenticationToolkit,
  ): void | Promise<void>
}

export interface SshClientConfig {
  readonly clock: () => number
  readonly randomBytes: (length: number) => Uint8Array
  readonly identification: IdentificationConfig
  readonly algorithms: AlgorithmCatalog
  readonly hostKeys: HostKeyStore
  readonly auth?: AuthenticationStrategy
  readonly channels?: ChannelPolicy
  readonly diagnostics?: DiagnosticsSink
  readonly guards?: EngineGuards
  readonly hostIdentity?: HostIdentity
  readonly crypto?: Crypto
}

export interface NegotiationSummary {
  readonly client: ReadonlyArray<string>
  readonly server?: ReadonlyArray<string>
}

export interface NegotiatedAlgorithms {
  readonly kex: string
  readonly cipherC2s: string
  readonly cipherS2c: string
  readonly macC2s: string
  readonly macS2c: string
  readonly hostKey: string
  readonly compressionC2s: string
  readonly compressionS2c: string
}

export interface ChannelDescriptor {
  readonly localId: ChannelId
  readonly remoteId: number | null
  readonly type: string
  readonly windowSize: number
  readonly maxPacketSize: number
}

export interface ChannelSnapshot extends ChannelDescriptor {
  readonly status: 'opening' | 'open' | 'closing' | 'closed'
}

export type ChannelRequestPayload =
  | {
      readonly type: 'pty-req'
      readonly wantReply?: boolean
      readonly term?: string
      readonly columns: number
      readonly rows: number
      readonly widthPixels?: number
      readonly heightPixels?: number
      readonly modes?: Uint8Array
    }
  | { readonly type: 'shell'; readonly wantReply?: boolean }
  | {
      readonly type: 'exec'
      readonly command: string
      readonly wantReply?: boolean
    }

export type GlobalRequestPayload =
  | {
      readonly type: 'tcpip-forward'
      readonly address: string
      readonly port: number
    }
  | {
      readonly type: 'cancel-tcpip-forward'
      readonly address: string
      readonly port: number
    }
  | { readonly type: 'keepalive@openssh.com'; readonly wantReply: boolean }
  | { readonly type: string; readonly data: Uint8Array }

export type ChannelOpenRequest =
  | {
      readonly type: 'session'
      readonly initialWindowSize?: number
      readonly maxPacketSize?: number
    }
  | {
      readonly type: 'direct-tcpip'
      readonly host: string
      readonly port: number
      readonly originHost: string
      readonly originPort: number
    }
  | {
      readonly type: 'direct-streamlocal'
      readonly path: string
      readonly reserved?: Uint8Array
    }

export interface DisconnectOptions {
  readonly code?: number
  readonly description?: string
  readonly language?: string
}

export type DisconnectSummary = {
  readonly code: number
  readonly description: string
  readonly language?: string
}

export type ClientIntent =
  | {
      readonly type: 'start-auth'
      readonly username: string
      readonly service?: string
    }
  | { readonly type: 'provide-password'; readonly password: string }
  | {
      readonly type: 'offer-public-key'
      readonly keyId: string
      readonly signature?: Uint8Array
    }
  | {
      readonly type: 'respond-keyboard-interactive'
      readonly responses: ReadonlyArray<string>
    }
  | { readonly type: 'open-channel'; readonly request: ChannelOpenRequest }
  | {
      readonly type: 'send-channel-data'
      readonly channelId: ChannelId
      readonly data: Uint8Array
    }
  | {
      readonly type: 'adjust-window'
      readonly channelId: ChannelId
      readonly delta: number
    }
  | {
      readonly type: 'request-channel'
      readonly channelId: ChannelId
      readonly request: ChannelRequestPayload
    }
  | { readonly type: 'request-global'; readonly request: GlobalRequestPayload }
  | {
      readonly type: 'signal-channel'
      readonly channelId: ChannelId
      readonly signal: string
    }
  | { readonly type: 'close-channel'; readonly channelId: ChannelId }
  | { readonly type: 'disconnect'; readonly reason?: DisconnectOptions }

export type SshEvent =
  | { readonly type: 'identification-sent'; readonly clientId: string }
  | {
      readonly type: 'identification-received'
      readonly serverId: string
      readonly raw: string
    }
  | { readonly type: 'kex-init-sent'; readonly summary: NegotiationSummary }
  | { readonly type: 'kex-init-received'; readonly summary: NegotiationSummary }
  | {
      readonly type: 'keys-established'
      readonly algorithms: NegotiatedAlgorithms
    }
  | {
      readonly type: 'outbound-data'
      readonly payload: Uint8Array
      readonly encryption: CipherStateLabel
    }
  | {
      readonly type: 'auth-banner'
      readonly message: string
      readonly language?: string
    }
  | {
      readonly type: 'auth-prompt'
      readonly prompts: ReadonlyArray<AuthPrompt>
    }
  | { readonly type: 'auth-success' }
  | {
      readonly type: 'auth-failure'
      readonly methodsLeft: ReadonlyArray<string>
      readonly partial: boolean
    }
  | { readonly type: 'channel-open'; readonly channel: ChannelDescriptor }
  | {
      readonly type: 'channel-data'
      readonly channelId: ChannelId
      readonly data: Uint8Array
    }
  | {
      readonly type: 'channel-window-adjust'
      readonly channelId: ChannelId
      readonly delta: number
    }
  | {
      readonly type: 'channel-request'
      readonly channelId: ChannelId
      readonly requestType: string
      readonly status: 'success' | 'failure'
      readonly request?: ChannelRequestPayload
    }
  | { readonly type: 'channel-eof'; readonly channelId: ChannelId }
  | {
      readonly type: 'channel-close'
      readonly channelId: ChannelId
      readonly exitStatus?: number
    }
  | {
      readonly type: 'channel-exit-status'
      readonly channelId: ChannelId
      readonly exitStatus: number
    }
  | {
      readonly type: 'channel-exit-signal'
      readonly channelId: ChannelId
      readonly signal: string
      readonly coreDumped: boolean
      readonly errorMessage?: string
      readonly language?: string
    }
  | { readonly type: 'global-request'; readonly request: GlobalRequestPayload }
  | { readonly type: 'disconnect'; readonly summary: DisconnectSummary }
  | {
      readonly type: 'warning'
      readonly code: string
      readonly message: string
      readonly detail?: unknown
    }

export interface SshSessionSnapshot {
  readonly phase: SessionPhase
  readonly negotiatedAlgorithms: NegotiatedAlgorithms | null
  readonly pendingOutboundPackets: number
  readonly openChannels: ReadonlyArray<ChannelSnapshot>
}

export interface SshSession {
  readonly events: AsyncIterable<SshEvent>
  receive(chunk: Uint8Array): void
  command(intent: ClientIntent): void
  nextEvent(): SshEvent | undefined
  flushOutbound(): ReadonlyArray<Uint8Array>
  inspect(): SshSessionSnapshot
  close(reason?: DisconnectOptions): void
  dispose(): void
  waitForIdle(): Promise<void>
}

const ASCII_ENCODER = new TextEncoder()
const ASCII_DECODER = new TextDecoder('utf-8', { fatal: false })
const SSH_MSG_DISCONNECT = 1
const SSH_MSG_KEXINIT = 20
const SSH_MSG_NEWKEYS = 21
const SSH_MSG_KEXDH_INIT = 30
const SSH_MSG_KEXDH_REPLY = 31
const SSH_MSG_GLOBAL_REQUEST = 80
const SSH_MSG_CHANNEL_OPEN = 90
const SSH_MSG_CHANNEL_OPEN_CONFIRMATION = 91
const SSH_MSG_CHANNEL_OPEN_FAILURE = 92
const SSH_MSG_CHANNEL_WINDOW_ADJUST = 93
const SSH_MSG_CHANNEL_DATA = 94
const SSH_MSG_CHANNEL_EXTENDED_DATA = 95
const SSH_MSG_CHANNEL_EOF = 96
const SSH_MSG_CHANNEL_CLOSE = 97
const SSH_MSG_CHANNEL_REQUEST = 98
const SSH_MSG_CHANNEL_SUCCESS = 99
const SSH_MSG_CHANNEL_FAILURE = 100
const MIN_PADDING_LENGTH = 4
const SSH_PACKET_BLOCK_SIZE = 8
const MAX_IDENTIFICATION_LENGTH = 255
const DEFAULT_CHANNEL_INITIAL_WINDOW = 128 * 1024
const DEFAULT_CHANNEL_MAX_PACKET_SIZE = 32 * 1024

const DH_GROUP14_PRIME = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
    '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
    'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
    'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
    '670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF',
)
const DH_GROUP14_GENERATOR = 2n

type Curve25519State = {
  readonly type: 'curve25519'
  readonly privateScalar: Uint8Array
  readonly clientPublic: Uint8Array
}

type Group14State = {
  readonly type: 'group14'
  readonly exponent: bigint
  readonly clientPublic: bigint
}

type KexState = Curve25519State | Group14State

type PlainCipherState = { type: 'none'; sequenceNumber: number }

type CipherDirectionState =
  | PlainCipherState
  | { type: 'aes128-gcm@openssh.com'; state: AesGcmDirectionState }

type ChannelStatus = 'opening' | 'open' | 'closing' | 'closed'

interface ChannelState {
  readonly localId: ChannelId
  remoteId: number | null
  readonly type: string
  status: ChannelStatus
  inboundWindow: number
  outboundWindow: number
  maxInboundPacketSize: number
  maxOutboundPacketSize: number
  remoteEof: boolean
  exitStatus: number | null
  pendingRequests: PendingChannelRequest[]
}

interface PendingChannelRequest {
  readonly requestType: string
  readonly request?: ChannelRequestPayload
}

function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

function concatBytes(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function createPlainCipherState(): PlainCipherState {
  return { type: 'none', sequenceNumber: 0 }
}

function encodeStringField(data: Uint8Array): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeUint32(data.length)
  writer.writeBytes(data)
  return writer.toUint8Array()
}

function encodeMpintField(value: bigint): Uint8Array {
  const writer = new BinaryWriter()
  writer.writeMpint(value)
  return writer.toUint8Array()
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

function littleEndianToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    result = (result << 8n) + BigInt(bytes[i] ?? 0)
  }
  return result
}

function bigIntToUint8Array(value: bigint): Uint8Array {
  if (value === 0n) {
    return new Uint8Array(0)
  }
  let hex = value.toString(16)
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function stripLineEnding(line: string): string {
  if (line.endsWith('\r\n')) {
    return line.slice(0, -2)
  }
  if (line.endsWith('\n') || line.endsWith('\r')) {
    return line.slice(0, -1)
  }
  return line
}

function bigEndianToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte)
  }
  return result
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

function toBufferSource(view: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = view
  const arrayBuffer = buffer as ArrayBuffer
  if (byteOffset === 0 && byteLength === arrayBuffer.byteLength) {
    return arrayBuffer
  }
  return arrayBuffer.slice(byteOffset, byteOffset + byteLength)
}

class ClientSessionImpl implements SshSession {
  readonly events: AsyncIterable<SshEvent>

  #config: SshClientConfig
  #crypto: Crypto
  #taskQueue: Promise<void> = Promise.resolve()
  #phase: SessionPhase = 'initial'
  #eventQueue = new AsyncEventQueue<SshEvent>()
  #syncEvents: SshEvent[] = []
  #outboundPackets: Uint8Array[] = []
  #closed = false

  #cipherClientToServer: CipherDirectionState
  #cipherServerToClient: CipherDirectionState
  #pendingClientCipher: CipherDirectionState | null = null
  #pendingServerCipher: CipherDirectionState | null = null

  #clientIdentificationLine: string
  #hostIdentity: HostIdentity
  #clientKexPayload: Uint8Array | null = null
  #serverKexPayload: Uint8Array | null = null
  #sessionId: Uint8Array | null = null
  #kexState: KexState | null = null
  #awaitingServerNewKeys = false
  #sharedSecret: Uint8Array | null = null

  #prefaceBuffer: Uint8Array = new Uint8Array(0)
  #binaryBuffer: Uint8Array = new Uint8Array(0)
  #serverIdentification: string | null = null
  #kexInitSent = false
  #kexInitReceived = false
  #negotiatedAlgorithms: NegotiatedAlgorithms | null = null

  #channels = new Map<ChannelId, ChannelState>()
  #nextChannelId = 0

  constructor(config: SshClientConfig) {
    this.#config = config
    this.events = this.#eventQueue
    const cryptoProvider = config.crypto ?? globalThis.crypto
    if (!cryptoProvider) {
      throw new SshInvariantViolation(
        'WebCrypto API is not available in this environment',
      )
    }
    this.#crypto = cryptoProvider
    this.#hostIdentity = config.hostIdentity ?? { host: 'unknown', port: 0 }
    this.#clientIdentificationLine = stripLineEnding(
      config.identification.clientId,
    )
    this.#cipherClientToServer = createPlainCipherState()
    this.#cipherServerToClient = createPlainCipherState()
    this.#sendIdentification()
  }

  receive(chunk: Uint8Array): void {
    this.#assertActive()
    if (chunk.length === 0) {
      return
    }

    if (this.#serverIdentification === null) {
      this.#prefaceBuffer = concatUint8Arrays(this.#prefaceBuffer, chunk)
      this.#processIdentificationBuffer()
    } else {
      this.#appendBinaryBuffer(chunk)
    }
  }

  command(intent: ClientIntent): void {
    this.#assertActive()
    switch (intent.type) {
      case 'open-channel':
        this.#handleCommandOpenChannel(intent.request)
        return
      case 'send-channel-data':
        this.#handleCommandSendChannelData(intent.channelId, intent.data)
        return
      case 'adjust-window':
        this.#handleCommandAdjustWindow(intent.channelId, intent.delta)
        return
      case 'request-channel':
        this.#handleCommandChannelRequest(intent.channelId, intent.request)
        return
      case 'close-channel':
        this.#handleCommandCloseChannel(intent.channelId)
        return
      case 'disconnect':
        this.close(intent.reason)
        return
      default:
        throw new SshNotImplementedError(
          `command handler for ${intent.type} is not implemented yet`,
        )
    }
  }

  nextEvent(): SshEvent | undefined {
    return this.#syncEvents.shift()
  }

  flushOutbound(): ReadonlyArray<Uint8Array> {
    if (this.#outboundPackets.length === 0) {
      return []
    }
    const packets = [...this.#outboundPackets]
    this.#outboundPackets.length = 0
    return packets
  }

  async waitForIdle(): Promise<void> {
    await this.#taskQueue
  }

  inspect(): SshSessionSnapshot {
    return {
      phase: this.#phase,
      negotiatedAlgorithms: this.#negotiatedAlgorithms,
      pendingOutboundPackets: this.#outboundPackets.length,
      openChannels: this.#collectChannelSnapshots(),
    }
  }

  close(_reason?: DisconnectOptions): void {
    if (this.#closed) return
    this.#closed = true
    this.#phase = 'closed'
    this.#eventQueue.close()
  }

  dispose(): void {
    this.close()
  }

  #sendIdentification(): void {
    const clientId = this.#config.identification.clientId
    if (!clientId.startsWith('SSH-')) {
      throw new SshInvariantViolation(
        'Client identification string must begin with "SSH-"',
      )
    }
    if (clientId.length > MAX_IDENTIFICATION_LENGTH) {
      throw new SshInvariantViolation(
        'Client identification string exceeds 255 characters',
      )
    }
    const normalized = stripLineEnding(clientId)
    this.#clientIdentificationLine = normalized
    const sendLine = clientId.endsWith('\n')
      ? clientId
      : `${clientId}${clientId.endsWith('\r') ? '\n' : '\r\n'}`
    const payload = ASCII_ENCODER.encode(sendLine)

    this.#phase = 'identification'
    this.#emit({ type: 'identification-sent', clientId: normalized })
    this.#enqueueOutbound(payload, this.#currentCipherLabel())
  }

  #processIdentificationBuffer(): void {
    let buffer = this.#prefaceBuffer
    while (true) {
      const newlineIndex = buffer.indexOf(0x0a)
      if (newlineIndex === -1) {
        break
      }
      const lineBytes = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      let line = ASCII_DECODER.decode(lineBytes)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      if (line.length === 0) {
        continue
      }
      if (!line.startsWith('SSH-')) {
        this.#recordDiagnostic(
          'debug',
          'preface-line',
          'Ignored server preface line',
          { line },
        )
        continue
      }
      if (line.length > MAX_IDENTIFICATION_LENGTH) {
        throw new SshProtocolError(
          'Server identification string exceeds 255 characters',
        )
      }

      this.#serverIdentification = line
      this.#phase = 'negotiating'
      this.#emit({ type: 'identification-received', serverId: line, raw: line })
      this.#ensureKexInitSent()

      if (buffer.length > 0) {
        this.#appendBinaryBuffer(buffer)
      }
      this.#prefaceBuffer = new Uint8Array(0)
      return
    }
    this.#prefaceBuffer = buffer
  }

  #appendBinaryBuffer(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return
    }
    this.#binaryBuffer = concatUint8Arrays(this.#binaryBuffer, chunk)
    this.#processBinaryPackets()
  }

  #processBinaryPackets(): void {
    while (this.#binaryBuffer.length >= 4) {
      const view = new DataView(
        this.#binaryBuffer.buffer,
        this.#binaryBuffer.byteOffset,
        this.#binaryBuffer.byteLength,
      )
      const packetLength = view.getUint32(0, false)
      const guard = this.#config.guards?.maxPayloadBytes
      if (typeof guard === 'number' && packetLength > guard) {
        throw new SshProtocolError(
          `Inbound packet length ${packetLength} exceeds guard limit ${guard}`,
        )
      }

      const cipher = this.#cipherServerToClient
      const tagLength =
        cipher.type === 'aes128-gcm@openssh.com' ? GCM_TAG_LENGTH_BYTES : 0
      const totalLength = 4 + packetLength + tagLength
      if (this.#binaryBuffer.length < totalLength) {
        return
      }

      const packet = this.#binaryBuffer.slice(0, totalLength)
      this.#binaryBuffer = this.#binaryBuffer.slice(totalLength)
      const additionalData = packet.slice(0, 4)
      const encrypted = packet.slice(4)

      if (cipher.type === 'none') {
        const plaintext = encrypted
        const payload = this.#extractPayload(packetLength, plaintext)
        this.#handlePayload(payload)
        continue
      }

      if (cipher.type === 'aes128-gcm@openssh.com') {
        const state = cipher.state
        this.#queueTask(async () => {
          const plaintext = await decryptAesGcm({
            crypto: this.#crypto,
            state,
            packetLength,
            encrypted,
            additionalData,
          })
          const payload = this.#extractPayload(packetLength, plaintext)
          this.#handlePayload(payload)
        })
        continue
      }

      throw new SshNotImplementedError('Inbound cipher is not supported yet')
    }
  }

  #extractPayload(packetLength: number, plaintext: Uint8Array): Uint8Array {
    if (plaintext.length !== packetLength) {
      throw new SshProtocolError(
        'Decrypted payload length does not match packet length',
      )
    }
    const paddingLength = plaintext[0]
    if (paddingLength === undefined) {
      throw new SshProtocolError('SSH packet missing padding length byte')
    }
    if (paddingLength < MIN_PADDING_LENGTH) {
      throw new SshProtocolError(
        `SSH packet padding length ${paddingLength} violates minimum ${MIN_PADDING_LENGTH}`,
      )
    }
    if (paddingLength >= packetLength) {
      throw new SshProtocolError(
        'SSH packet padding length consumes entire packet',
      )
    }
    const payloadLength = packetLength - paddingLength - 1
    if (payloadLength < 0) {
      throw new SshProtocolError('SSH packet payload length underflow detected')
    }
    return plaintext.slice(1, 1 + payloadLength)
  }

  #resolveHashAlgorithm(kex: string): HashAlgorithm {
    switch (kex) {
      case 'curve25519-sha256@libssh.org':
      case 'curve25519-sha256':
      case 'diffie-hellman-group14-sha256':
        return 'SHA-256'
      default:
        throw new SshNotImplementedError(
          `Hash algorithm for key exchange ${kex} is not implemented yet`,
        )
    }
  }

  async #prepareCipherSuites(params: {
    negotiated: NegotiatedAlgorithms
    sharedSecret: Uint8Array
    exchangeHash: Uint8Array
    sessionId: Uint8Array
    hashAlgorithm: HashAlgorithm
  }): Promise<void> {
    const { negotiated, sharedSecret, exchangeHash, sessionId, hashAlgorithm } =
      params
    if (
      negotiated.cipherC2s !== 'aes128-gcm@openssh.com' ||
      negotiated.cipherS2c !== 'aes128-gcm@openssh.com'
    ) {
      throw new SshNotImplementedError(
        `Cipher suites ${negotiated.cipherC2s}/${negotiated.cipherS2c} are not implemented yet`,
      )
    }

    const c2sIv = await deriveKeyMaterial({
      crypto: this.#crypto,
      hashAlgorithm,
      sharedSecret,
      exchangeHash,
      sessionId,
      letter: 'A'.charCodeAt(0),
      length: 12,
    })
    const s2cIv = await deriveKeyMaterial({
      crypto: this.#crypto,
      hashAlgorithm,
      sharedSecret,
      exchangeHash,
      sessionId,
      letter: 'B'.charCodeAt(0),
      length: 12,
    })
    const c2sKeyBytes = await deriveKeyMaterial({
      crypto: this.#crypto,
      hashAlgorithm,
      sharedSecret,
      exchangeHash,
      sessionId,
      letter: 'C'.charCodeAt(0),
      length: 16,
    })
    const s2cKeyBytes = await deriveKeyMaterial({
      crypto: this.#crypto,
      hashAlgorithm,
      sharedSecret,
      exchangeHash,
      sessionId,
      letter: 'D'.charCodeAt(0),
      length: 16,
    })

    const { fixed: c2sFixed, invocation: c2sInvocation } = splitInitialIv(c2sIv)
    const { fixed: s2cFixed, invocation: s2cInvocation } = splitInitialIv(s2cIv)
    const c2sKey = await importAesGcmKey(this.#crypto, c2sKeyBytes)
    const s2cKey = await importAesGcmKey(this.#crypto, s2cKeyBytes)

    this.#pendingClientCipher = {
      type: 'aes128-gcm@openssh.com',
      state: {
        algorithm: 'aes128-gcm@openssh.com',
        key: c2sKey,
        fixedIv: c2sFixed,
        invocationCounter: c2sInvocation,
        sequenceNumber: 0,
      },
    }
    this.#pendingServerCipher = {
      type: 'aes128-gcm@openssh.com',
      state: {
        algorithm: 'aes128-gcm@openssh.com',
        key: s2cKey,
        fixedIv: s2cFixed,
        invocationCounter: s2cInvocation,
        sequenceNumber: 0,
      },
    }

    this.#recordDiagnostic(
      'info',
      'cipher-prepared',
      'Prepared AES-GCM key material',
      {
        cipherC2s: negotiated.cipherC2s,
        cipherS2c: negotiated.cipherS2c,
      },
    )
  }

  #activatePendingClientCipher(): void {
    if (!this.#pendingClientCipher) {
      return
    }
    this.#cipherClientToServer = this.#pendingClientCipher
    this.#pendingClientCipher = null
    const algorithm =
      this.#cipherClientToServer.type === 'none'
        ? 'none'
        : this.#cipherClientToServer.state.algorithm
    this.#recordDiagnostic(
      'info',
      'cipher-activated-c2s',
      'Activated client-to-server cipher',
      {
        algorithm,
      },
    )
  }

  #activatePendingServerCipher(): void {
    if (!this.#pendingServerCipher) {
      return
    }
    this.#cipherServerToClient = this.#pendingServerCipher
    this.#pendingServerCipher = null
    const algorithm =
      this.#cipherServerToClient.type === 'none'
        ? 'none'
        : this.#cipherServerToClient.state.algorithm
    this.#recordDiagnostic(
      'info',
      'cipher-activated-s2c',
      'Activated server-to-client cipher',
      {
        algorithm,
      },
    )
  }

  #currentCipherLabel(): CipherStateLabel {
    return this.#cipherClientToServer.type === 'none' ? 'initial' : 'rekey'
  }

  #handlePayload(payload: Uint8Array): void {
    const reader = new BinaryReader(payload)
    const messageId = reader.readUint8()
    switch (messageId) {
      case SSH_MSG_DISCONNECT:
        this.#handleDisconnect(reader)
        return
      case SSH_MSG_KEXINIT:
        this.#handleServerKexInit(payload)
        return
      case SSH_MSG_NEWKEYS:
        this.#handleNewKeys()
        return
      case SSH_MSG_KEXDH_REPLY:
        this.#handleKeyExchangeReply(reader)
        return
      case SSH_MSG_GLOBAL_REQUEST:
        this.#handleGlobalRequest(reader)
        return
      case SSH_MSG_CHANNEL_OPEN_CONFIRMATION:
        this.#handleChannelOpenConfirmation(reader)
        return
      case SSH_MSG_CHANNEL_OPEN_FAILURE:
        this.#handleChannelOpenFailure(reader)
        return
      case SSH_MSG_CHANNEL_WINDOW_ADJUST:
        this.#handleChannelWindowAdjust(reader)
        return
      case SSH_MSG_CHANNEL_DATA:
        this.#handleChannelData(reader, false)
        return
      case SSH_MSG_CHANNEL_EXTENDED_DATA:
        this.#handleChannelData(reader, true)
        return
      case SSH_MSG_CHANNEL_EOF:
        this.#handleChannelEof(reader)
        return
      case SSH_MSG_CHANNEL_CLOSE:
        this.#handleChannelClose(reader)
        return
      case SSH_MSG_CHANNEL_REQUEST:
        this.#handleChannelRequest(reader)
        return
      case SSH_MSG_CHANNEL_SUCCESS:
        this.#handleChannelRequestSuccess(reader)
        return
      case SSH_MSG_CHANNEL_FAILURE:
        this.#handleChannelRequestFailure(reader)
        return
      case SSH_MSG_CHANNEL_OPEN:
        this.#emitWarning(
          'channel-open-unsupported',
          'Server initiated channel-open is not supported yet',
        )
        return
      default:
        this.#emitWarning(
          'unsupported-message',
          `Received unsupported SSH message ${messageId}`,
        )
    }
  }

  #handleServerKexInit(payload: Uint8Array): void {
    this.#serverKexPayload = payload
    const reader = new BinaryReader(payload.subarray(1))
    reader.readBytes(16) // cookie (unused)
    const serverKex = reader.readNameList()
    const serverHostKeys = reader.readNameList()
    const encC2s = reader.readNameList()
    const encS2c = reader.readNameList()
    const macC2s = reader.readNameList()
    const macS2c = reader.readNameList()
    const compC2s = reader.readNameList()
    const compS2c = reader.readNameList()
    const languagesC2s = reader.readNameList()
    const languagesS2c = reader.readNameList()
    const firstKexPacketFollows = reader.readBoolean()
    const reserved = reader.readUint32()

    if (firstKexPacketFollows) {
      this.#emitWarning(
        'first-kex-packet-follows',
        'Server sent first_kex_packet_follows=true',
      )
    }
    if (reserved !== 0) {
      this.#emitWarning(
        'nonzero-reserved',
        'Server set non-zero reserved value in KEXINIT',
        reserved,
      )
    }
    if (!this.#kexInitSent) {
      this.#ensureKexInitSent()
    }

    const summary: NegotiationSummary = {
      client: this.#clientKexAlgorithms(),
      server: serverKex,
    }
    this.#emit({ type: 'kex-init-received', summary })
    this.#recordDiagnostic(
      'info',
      'kex-init-received',
      'Received SSH_MSG_KEXINIT',
      {
        serverKex,
        serverHostKeys,
        encC2s,
        encS2c,
        macC2s,
        macS2c,
        compC2s,
        compS2c,
        languagesC2s,
        languagesS2c,
      },
    )

    const negotiated = this.#negotiateAlgorithms({
      serverKex,
      serverHostKeys,
      encC2s,
      encS2c,
      macC2s,
      macS2c,
      compC2s,
      compS2c,
    })
    this.#negotiatedAlgorithms = negotiated
    this.#recordDiagnostic(
      'info',
      'algorithms-negotiated',
      'Negotiated algorithm suite',
      negotiated,
    )

    this.#kexInitReceived = true
    this.#phase = 'kex'
    this.#queueTask(() => this.#beginNegotiatedKeyExchange())
  }

  #ensureKexInitSent(): void {
    if (this.#kexInitSent) {
      return
    }

    const payload = this.#buildClientKexInitPayload()
    const summary: NegotiationSummary = {
      client: this.#clientKexAlgorithms(),
    }

    this.#kexInitSent = true
    this.#emit({ type: 'kex-init-sent', summary })
    this.#recordDiagnostic(
      'info',
      'kex-init-sent',
      'Sent SSH_MSG_KEXINIT',
      summary,
    )
    this.#sendPacket(payload)
  }

  #buildClientKexInitPayload(): Uint8Array {
    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_KEXINIT)
    writer.writeBytes(this.#config.randomBytes(16))

    const { algorithms } = this.#config
    const kexAlgorithms = this.#clientKexAlgorithms()
    writer.writeNameList(kexAlgorithms)
    writer.writeNameList([...algorithms.hostKeys])
    writer.writeNameList([...algorithms.ciphers])
    writer.writeNameList([...algorithms.ciphers])
    writer.writeNameList([...algorithms.macs])
    writer.writeNameList([...algorithms.macs])
    writer.writeNameList([...algorithms.compression])
    writer.writeNameList([...algorithms.compression])
    writer.writeNameList([])
    writer.writeNameList([])
    writer.writeBoolean(false)
    writer.writeUint32(0)

    const payload = writer.toUint8Array()
    this.#clientKexPayload = payload
    return payload
  }

  async #wrapPacket(payload: Uint8Array): Promise<Uint8Array> {
    const cipher = this.#cipherClientToServer
    switch (cipher.type) {
      case 'none':
        return this.#wrapPlainPacket(payload)
      case 'aes128-gcm@openssh.com':
        return this.#wrapAesGcmPacket(cipher.state, payload)
      default:
        throw new SshNotImplementedError('Outbound cipher is not supported yet')
    }
  }

  #wrapPlainPacket(payload: Uint8Array): Uint8Array {
    let paddingLength = MIN_PADDING_LENGTH
    while ((payload.length + paddingLength + 1) % SSH_PACKET_BLOCK_SIZE !== 0) {
      paddingLength += 1
    }
    if (paddingLength > 255) {
      throw new SshInvariantViolation(
        'Computed SSH padding length exceeds 255 bytes',
      )
    }

    const packetLength = payload.length + paddingLength + 1
    const writer = new BinaryWriter()
    writer.writeUint32(packetLength)
    writer.writeUint8(paddingLength)
    writer.writeBytes(payload)
    writer.writeBytes(this.#config.randomBytes(paddingLength))
    return writer.toUint8Array()
  }

  async #wrapAesGcmPacket(
    state: AesGcmDirectionState,
    payload: Uint8Array,
  ): Promise<Uint8Array> {
    const blockSize = 16
    let paddingLength = MIN_PADDING_LENGTH
    const baseLength = payload.length + 1
    while ((baseLength + paddingLength) % blockSize !== 0) {
      paddingLength += 1
    }
    if (paddingLength > 255) {
      throw new SshInvariantViolation(
        'Computed SSH padding length exceeds 255 bytes',
      )
    }
    const padding = this.#config.randomBytes(paddingLength)
    if (padding.length !== paddingLength) {
      throw new SshInvariantViolation(
        'randomBytes did not return requested padding length',
      )
    }

    const packetLength = baseLength + paddingLength
    const guard = this.#config.guards?.maxPayloadBytes
    if (typeof guard === 'number' && packetLength > guard) {
      throw new SshProtocolError(
        `Outbound packet length ${packetLength} exceeds guard limit ${guard}`,
      )
    }
    const plaintext = new Uint8Array(packetLength)
    plaintext[0] = paddingLength
    plaintext.set(payload, 1)
    plaintext.set(padding, 1 + payload.length)

    const additionalData = new Uint8Array(4)
    const view = new DataView(additionalData.buffer)
    view.setUint32(0, packetLength, false)

    const { ciphertext } = await encryptAesGcm({
      crypto: this.#crypto,
      state,
      plaintext,
      additionalData,
    })

    const packet = new Uint8Array(4 + ciphertext.length)
    packet.set(additionalData, 0)
    packet.set(ciphertext, 4)
    return packet
  }

  #clientKexAlgorithms(): ReadonlyArray<string> {
    const { algorithms } = this.#config
    const list: string[] = [...algorithms.keyExchange]
    if (algorithms.extensions?.length) {
      list.push(...algorithms.extensions)
    }
    return list
  }

  #negotiateAlgorithms(params: {
    serverKex: ReadonlyArray<string>
    serverHostKeys: ReadonlyArray<string>
    encC2s: ReadonlyArray<string>
    encS2c: ReadonlyArray<string>
    macC2s: ReadonlyArray<string>
    macS2c: ReadonlyArray<string>
    compC2s: ReadonlyArray<string>
    compS2c: ReadonlyArray<string>
  }): NegotiatedAlgorithms {
    const { algorithms } = this.#config
    const clientKex = this.#clientKexAlgorithms()

    const kex = this.#selectMutualAlgorithm(
      'key exchange',
      clientKex,
      params.serverKex,
    )
    const hostKey = this.#selectMutualAlgorithm(
      'server host key',
      algorithms.hostKeys,
      params.serverHostKeys,
    )
    const cipherC2s = this.#selectMutualAlgorithm(
      'cipher (client-to-server)',
      algorithms.ciphers,
      params.encC2s,
    )
    const cipherS2c = this.#selectMutualAlgorithm(
      'cipher (server-to-client)',
      algorithms.ciphers,
      params.encS2c,
    )
    const macC2s = this.#selectMutualAlgorithm(
      'MAC (client-to-server)',
      algorithms.macs,
      params.macC2s,
    )
    const macS2c = this.#selectMutualAlgorithm(
      'MAC (server-to-client)',
      algorithms.macs,
      params.macS2c,
    )
    const compressionC2s = this.#selectMutualAlgorithm(
      'compression (client-to-server)',
      algorithms.compression,
      params.compC2s,
    )
    const compressionS2c = this.#selectMutualAlgorithm(
      'compression (server-to-client)',
      algorithms.compression,
      params.compS2c,
    )

    return {
      kex,
      hostKey,
      cipherC2s,
      cipherS2c,
      macC2s,
      macS2c,
      compressionC2s,
      compressionS2c,
    }
  }

  #selectMutualAlgorithm(
    category: string,
    client: ReadonlyArray<string>,
    server: ReadonlyArray<string>,
  ): string {
    for (const candidate of client) {
      if (server.includes(candidate)) {
        return candidate
      }
    }

    const message = `No mutual ${category} algorithm found (client: ${client.join(', ')}, server: ${server.join(', ')})`
    this.#recordDiagnostic('error', 'algorithm-mismatch', message, {
      category,
      client,
      server,
    })
    throw new SshProtocolError(message)
  }

  #beginNegotiatedKeyExchange(): void {
    const negotiated = this.#negotiatedAlgorithms
    if (!negotiated) {
      return
    }
    switch (negotiated.kex) {
      case 'curve25519-sha256@libssh.org':
      case 'curve25519-sha256':
        this.#startCurve25519Exchange()
        break
      case 'diffie-hellman-group14-sha256':
        this.#startGroup14Exchange()
        break
      default:
        throw new SshNotImplementedError(
          `Key exchange algorithm ${negotiated.kex} is not supported yet`,
        )
    }
  }

  #startCurve25519Exchange(): void {
    const seed = this.#config.randomBytes(32)
    if (seed.length !== 32) {
      throw new SshInvariantViolation('curve25519 requires 32 bytes of entropy')
    }
    const privateScalar = clampScalar(seed)
    const clientPublic = scalarMultBase(privateScalar)
    this.#kexState = {
      type: 'curve25519',
      privateScalar,
      clientPublic,
    }

    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_KEXDH_INIT)
    writer.writeUint32(clientPublic.length)
    writer.writeBytes(clientPublic)
    const payload = writer.toUint8Array()
    this.#recordDiagnostic(
      'info',
      'kex-ecdh-init',
      'Sent SSH_MSG_KEX_ECDH_INIT',
    )
    this.#sendPacket(payload)
  }

  #startGroup14Exchange(): void {
    const entropy = this.#config.randomBytes(32)
    if (entropy.length === 0) {
      throw new SshInvariantViolation(
        'diffie-hellman-group14 requires entropy bytes',
      )
    }
    const exponent = this.#normalizeDhExponent(entropy)
    const clientPublic = modPow(
      DH_GROUP14_GENERATOR,
      exponent,
      DH_GROUP14_PRIME,
    )
    this.#kexState = {
      type: 'group14',
      exponent,
      clientPublic,
    }

    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_KEXDH_INIT)
    writer.writeMpint(clientPublic)
    const payload = writer.toUint8Array()
    this.#recordDiagnostic('info', 'kex-dh-init', 'Sent SSH_MSG_KEXDH_INIT')
    this.#sendPacket(payload)
  }

  #normalizeDhExponent(entropy: Uint8Array): bigint {
    const modulus = DH_GROUP14_PRIME - 2n
    const value = bigEndianToBigInt(entropy)
    const exponent = (value % modulus) + 2n
    return exponent
  }

  #handleKeyExchangeReply(reader: BinaryReader): void {
    const state = this.#kexState
    if (!state) {
      this.#emitWarning(
        'unexpected-kex-reply',
        'Received KEX reply without active exchange',
      )
      return
    }

    const hostKeyLength = reader.readUint32()
    const hostKey = reader.readBytes(hostKeyLength)

    if (state.type === 'curve25519') {
      const serverPublicLength = reader.readUint32()
      const serverPublic = reader.readBytes(serverPublicLength)
      const signatureLength = reader.readUint32()
      const signature = reader.readBytes(signatureLength)
      this.#queueTask(() =>
        this.#finalizeCurve25519Exchange({
          hostKey,
          serverPublic,
          signature,
          state,
        }),
      )
    } else {
      const serverPublic = reader.readMpint()
      const signatureLength = reader.readUint32()
      const signature = reader.readBytes(signatureLength)
      this.#queueTask(() =>
        this.#finalizeGroup14Exchange({
          hostKey,
          serverPublic,
          signature,
          state,
        }),
      )
    }
  }

  async #finalizeCurve25519Exchange(params: {
    hostKey: Uint8Array
    serverPublic: Uint8Array
    signature: Uint8Array
    state: Curve25519State
  }): Promise<void> {
    if (params.serverPublic.length !== 32) {
      throw new SshProtocolError('Invalid curve25519 server public key length')
    }
    const sharedSecretBytes = scalarMult(
      params.state.privateScalar,
      params.serverPublic,
    )
    await this.#finalizeKeyExchange({
      hostKey: params.hostKey,
      signature: params.signature,
      clientExchange: { type: 'string', data: params.state.clientPublic },
      serverExchange: { type: 'string', data: params.serverPublic },
      sharedSecret: { bytes: sharedSecretBytes, littleEndian: true },
    })
  }

  async #finalizeGroup14Exchange(params: {
    hostKey: Uint8Array
    serverPublic: bigint
    signature: Uint8Array
    state: Group14State
  }): Promise<void> {
    if (
      params.serverPublic <= 1n ||
      params.serverPublic >= DH_GROUP14_PRIME - 1n
    ) {
      throw new SshProtocolError(
        'Server supplied invalid Diffie-Hellman public key',
      )
    }
    const sharedSecret = modPow(
      params.serverPublic,
      params.state.exponent,
      DH_GROUP14_PRIME,
    )
    const sharedSecretBytes = bigIntToUint8Array(sharedSecret)
    await this.#finalizeKeyExchange({
      hostKey: params.hostKey,
      signature: params.signature,
      clientExchange: { type: 'mpint', value: params.state.clientPublic },
      serverExchange: { type: 'mpint', value: params.serverPublic },
      sharedSecret: { bytes: sharedSecretBytes, littleEndian: false },
    })
  }

  async #finalizeKeyExchange(params: {
    hostKey: Uint8Array
    signature: Uint8Array
    clientExchange:
      | { type: 'string'; data: Uint8Array }
      | { type: 'mpint'; value: bigint }
    serverExchange:
      | { type: 'string'; data: Uint8Array }
      | { type: 'mpint'; value: bigint }
    sharedSecret: { bytes: Uint8Array; littleEndian: boolean }
  }): Promise<void> {
    const negotiated = this.#negotiatedAlgorithms
    if (!negotiated) {
      throw new SshInvariantViolation(
        'Negotiated algorithms missing during key finalization',
      )
    }
    if (!this.#clientKexPayload || !this.#serverKexPayload) {
      throw new SshInvariantViolation(
        'Missing KEXINIT payloads for exchange hash computation',
      )
    }
    if (!this.#serverIdentification) {
      throw new SshInvariantViolation(
        'Server identification missing before key finalization',
      )
    }

    const parsedHostKey = this.#parseHostKey(params.hostKey)
    if (parsedHostKey.algorithm !== negotiated.hostKey) {
      throw new SshProtocolError(
        `Server host key algorithm ${parsedHostKey.algorithm} does not match negotiated ${negotiated.hostKey}`,
      )
    }

    const parsedSignature = this.#parseSignature(params.signature)
    if (parsedSignature.algorithm !== negotiated.hostKey) {
      throw new SshProtocolError(
        `Server signature algorithm ${parsedSignature.algorithm} does not match negotiated host key ${negotiated.hostKey}`,
      )
    }

    const hashAlgorithm = this.#resolveHashAlgorithm(negotiated.kex)

    const sharedSecretBigInt = params.sharedSecret.littleEndian
      ? littleEndianToBigInt(params.sharedSecret.bytes)
      : bigEndianToBigInt(params.sharedSecret.bytes)
    const clientField =
      params.clientExchange.type === 'string'
        ? encodeStringField(params.clientExchange.data)
        : encodeMpintField(params.clientExchange.value)
    const serverField =
      params.serverExchange.type === 'string'
        ? encodeStringField(params.serverExchange.data)
        : encodeMpintField(params.serverExchange.value)
    const sharedSecretField = encodeMpintField(sharedSecretBigInt)

    const hashInput = concatBytes(
      ASCII_ENCODER.encode(this.#clientIdentificationLine),
      ASCII_ENCODER.encode(stripLineEnding(this.#serverIdentification)),
      this.#clientKexPayload,
      this.#serverKexPayload,
      encodeStringField(params.hostKey),
      clientField,
      serverField,
      sharedSecretField,
    )
    const exchangeHashBuffer = await this.#crypto.subtle.digest(
      hashAlgorithm,
      toBufferSource(hashInput),
    )
    const exchangeHash = new Uint8Array(exchangeHashBuffer)
    if (this.#sessionId === null) {
      this.#sessionId = exchangeHash
    }
    const sessionId = this.#sessionId
    if (!sessionId) {
      throw new SshInvariantViolation(
        'Session identifier is missing after key exchange',
      )
    }

    const hostKeyDecision = await this.#evaluateHostKey(
      parsedHostKey.algorithm,
      params.hostKey,
    )
    if (
      hostKeyDecision.outcome === 'mismatch' &&
      hostKeyDecision.severity === 'fatal'
    ) {
      throw new SshProtocolError('Host key mismatch reported by policy')
    }
    if (hostKeyDecision.outcome === 'mismatch') {
      this.#emitWarning(
        'host-key-mismatch',
        'Host key mismatch reported by policy',
        hostKeyDecision,
      )
    }

    const signatureValid = await this.#verifyHostKeySignature(
      parsedHostKey.algorithm,
      parsedHostKey.publicKey,
      parsedSignature.signature,
      exchangeHash,
    )
    if (!signatureValid) {
      throw new SshProtocolError('Host key signature verification failed')
    }

    await this.#prepareCipherSuites({
      negotiated,
      sharedSecret: sharedSecretField,
      exchangeHash,
      sessionId,
      hashAlgorithm,
    })

    this.#sharedSecret = new Uint8Array(params.sharedSecret.bytes)
    this.#kexState = null
    this.#recordDiagnostic(
      'info',
      'keys-established',
      'Key exchange completed successfully',
      {
        algorithm: negotiated.kex,
        hostKey: negotiated.hostKey,
      },
    )
    this.#emit({ type: 'keys-established', algorithms: negotiated })

    this.#awaitingServerNewKeys = true
    const newKeysPayload = this.#buildNewKeysPayload()
    this.#queueTask(async () => {
      const packet = await this.#wrapPacket(newKeysPayload)
      this.#enqueueOutbound(packet, this.#currentCipherLabel())
      this.#activatePendingClientCipher()
    })
  }

  async #verifyHostKeySignature(
    algorithm: string,
    publicKey: Uint8Array,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean> {
    switch (algorithm) {
      case 'ssh-ed25519': {
        const key = await this.#crypto.subtle.importKey(
          'raw',
          toBufferSource(publicKey),
          { name: 'Ed25519' },
          false,
          ['verify'],
        )
        return this.#crypto.subtle.verify(
          'Ed25519',
          key,
          toBufferSource(signature),
          toBufferSource(data),
        )
      }
      default:
        throw new SshNotImplementedError(
          `Host key verification not implemented for ${algorithm}`,
        )
    }
  }

  async #evaluateHostKey(
    algorithm: string,
    rawBlob: Uint8Array,
  ): Promise<HostKeyDecision> {
    const fingerprintBytes = new Uint8Array(
      await this.#crypto.subtle.digest('SHA-256', toBufferSource(rawBlob)),
    )
    const candidate: HostKeyCandidate = {
      host: this.#hostIdentity.host,
      port: this.#hostIdentity.port,
      keyType: algorithm,
      fingerprint: toHex(fingerprintBytes),
      raw: rawBlob,
    }
    const decision = await this.#config.hostKeys.evaluate(candidate)
    if (decision.outcome === 'trusted' && this.#config.hostKeys.remember) {
      await this.#config.hostKeys.remember(candidate, decision)
    }
    return decision
  }

  #buildNewKeysPayload(): Uint8Array {
    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_NEWKEYS)
    return writer.toUint8Array()
  }

  #handleNewKeys(): void {
    if (!this.#awaitingServerNewKeys) {
      this.#emitWarning(
        'unexpected-newkeys',
        'Received unexpected SSH_MSG_NEWKEYS from server',
      )
    }
    this.#awaitingServerNewKeys = false
    this.#activatePendingServerCipher()
    if (!this.#closed && this.#phase !== 'failed') {
      this.#phase = 'authenticated'
    }
    this.#recordDiagnostic(
      'info',
      'newkeys-received',
      'Server confirmed key transition',
    )
  }

  #sendPacket(payload: Uint8Array): void {
    this.#queueTask(async () => {
      const packet = await this.#wrapPacket(payload)
      this.#enqueueOutbound(packet, this.#currentCipherLabel())
    })
  }

  #handleDisconnect(reader: BinaryReader): void {
    const code = reader.readUint32()
    const description = reader.readString()
    const language = reader.readString()
    const summary: DisconnectSummary = {
      code,
      description,
      language: language.length > 0 ? language : undefined,
    }
    this.#emit({ type: 'disconnect', summary })
    this.close({ code, description, language })
  }

  #handleGlobalRequest(reader: BinaryReader): void {
    const requestName = reader.readString()
    const wantReply = reader.readBoolean()
    const payloadBytes = reader.readRemaining()
    const inner = new BinaryReader(payloadBytes)
    let request: GlobalRequestPayload
    switch (requestName) {
      case 'keepalive@openssh.com':
        request = { type: 'keepalive@openssh.com', wantReply }
        break
      case 'tcpip-forward': {
        const address = inner.readString()
        const port = inner.readUint32()
        request = { type: 'tcpip-forward', address, port }
        break
      }
      case 'cancel-tcpip-forward': {
        const address = inner.readString()
        const port = inner.readUint32()
        request = { type: 'cancel-tcpip-forward', address, port }
        break
      }
      default:
        request = { type: requestName, data: payloadBytes }
        if (wantReply) {
          this.#emitWarning(
            'global-request-unhandled',
            `Unhandled global request ${requestName} requested a reply`,
          )
        }
        break
    }
    this.#emit({ type: 'global-request', request })
  }

  #handleChannelOpenConfirmation(reader: BinaryReader): void {
    const recipientChannel = reader.readUint32()
    const state = this.#channels.get(recipientChannel as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-open-unknown',
        `Received CHANNEL_OPEN_CONFIRMATION for unknown channel ${recipientChannel}`,
      )
      return
    }
    const remoteId = reader.readUint32()
    const initialWindow = reader.readUint32()
    const maxPacketSize = reader.readUint32()

    state.remoteId = remoteId >>> 0
    state.outboundWindow = initialWindow >>> 0
    state.maxOutboundPacketSize = maxPacketSize >>> 0
    state.status = state.remoteEof ? 'closing' : 'open'
    if (this.#phase === 'authenticated') {
      this.#phase = 'connected'
    }
    this.#emit({
      type: 'channel-open',
      channel: this.#channelDescriptorFromState(state),
    })
    this.#recordDiagnostic(
      'info',
      'channel-open-confirmation',
      'Server confirmed channel open',
      {
        localId: recipientChannel,
        remoteId,
        initialWindow,
        maxPacketSize,
      },
    )
  }

  #handleChannelOpenFailure(reader: BinaryReader): void {
    const recipientChannel = reader.readUint32()
    const reasonCode = reader.readUint32()
    const description = reader.readString()
    reader.readString() // language tag (unused)
    this.#channels.delete(recipientChannel as ChannelId)
    this.#emitWarning(
      'channel-open-failure',
      `Channel open failed with reason ${reasonCode}: ${description}`,
    )
  }

  #handleChannelWindowAdjust(reader: BinaryReader): void {
    const recipient = reader.readUint32()
    const delta = reader.readUint32()
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-window-adjust-unknown',
        `Window adjust for unknown channel ${recipient}`,
      )
      return
    }
    const newWindow = state.outboundWindow + delta
    state.outboundWindow = newWindow > 0xffff_ffff ? 0xffff_ffff : newWindow
    this.#emit({
      type: 'channel-window-adjust',
      channelId: state.localId,
      delta,
    })
  }

  #handleChannelData(reader: BinaryReader, extended: boolean): void {
    const recipient = reader.readUint32()
    const dataLength = reader.readUint32()
    const dataBytes = reader.readBytes(dataLength)
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        extended ? 'channel-extended-data-unknown' : 'channel-data-unknown',
        `Data received for unknown channel ${recipient}`,
      )
      return
    }
    state.inboundWindow = Math.max(0, state.inboundWindow - dataBytes.length)
    if (extended) {
      this.#emitWarning(
        'channel-extended-data-unsupported',
        'Extended channel data is not supported yet',
      )
      return
    }
    const copy = new Uint8Array(dataBytes)
    this.#emit({
      type: 'channel-data',
      channelId: state.localId,
      data: copy,
    })
  }

  #handleChannelEof(reader: BinaryReader): void {
    const recipient = reader.readUint32()
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-eof-unknown',
        `EOF for unknown channel ${recipient}`,
      )
      return
    }
    state.remoteEof = true
    if (state.status === 'open') {
      state.status = 'closing'
    }
    this.#emit({ type: 'channel-eof', channelId: state.localId })
  }

  #handleChannelClose(reader: BinaryReader): void {
    const recipient = reader.readUint32()
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-close-unknown',
        `Close for unknown channel ${recipient}`,
      )
      return
    }
    if (state.remoteId !== null && state.status !== 'closing') {
      const writer = new BinaryWriter()
      writer.writeUint8(SSH_MSG_CHANNEL_CLOSE)
      writer.writeUint32(state.remoteId >>> 0)
      this.#sendPacket(writer.toUint8Array())
    }
    state.status = 'closed'
    this.#emit({
      type: 'channel-close',
      channelId: state.localId,
      exitStatus: state.exitStatus ?? undefined,
    })
  }

  #handleChannelRequest(reader: BinaryReader): void {
    const recipient = reader.readUint32()
    const requestType = reader.readString()
    const wantReply = reader.readBoolean()
    const payload = reader.readRemaining()
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-request-unknown',
        `Channel request ${requestType} for unknown channel ${recipient}`,
      )
      return
    }
    switch (requestType) {
      case 'exit-status': {
        const exitReader = new BinaryReader(payload)
        const status = exitReader.readUint32()
        state.exitStatus = status
        this.#emit({
          type: 'channel-exit-status',
          channelId: state.localId,
          exitStatus: status,
        })
        return
      }
      case 'exit-signal': {
        const signalReader = new BinaryReader(payload)
        const signalName = signalReader.readString()
        const coreDumped = signalReader.readBoolean()
        const errorMessage = signalReader.readString()
        const language = signalReader.readString()
        this.#emit({
          type: 'channel-exit-signal',
          channelId: state.localId,
          signal: signalName,
          coreDumped,
          errorMessage: errorMessage.length > 0 ? errorMessage : undefined,
          language: language.length > 0 ? language : undefined,
        })
        return
      }
      default:
        this.#emitWarning(
          'channel-request-unsupported',
          `Channel request ${requestType} is not supported yet`,
          { wantReply },
        )
        if (wantReply) {
          this.#emitWarning(
            'channel-request-reply-ignored',
            `Ignoring reply requested for channel request ${requestType}`,
          )
        }
    }
  }

  #handleCommandOpenChannel(request: ChannelOpenRequest): void {
    if (this.#phase !== 'authenticated' && this.#phase !== 'connected') {
      throw new SshProtocolError(
        'Cannot open channels before key exchange completes',
      )
    }
    if (request.type !== 'session') {
      throw new SshNotImplementedError(
        `channel-open for ${request.type} is not implemented yet`,
      )
    }
    const localId = this.#allocateChannelId()
    const initialWindow =
      request.initialWindowSize ?? this.#defaultChannelInitialWindow()
    const maxPacketSize =
      request.maxPacketSize ?? this.#defaultChannelMaxPacketSize()

    const state: ChannelState = {
      localId,
      remoteId: null,
      type: request.type,
      status: 'opening',
      inboundWindow: initialWindow >>> 0,
      outboundWindow: 0,
      maxInboundPacketSize: maxPacketSize >>> 0,
      maxOutboundPacketSize: 0,
      remoteEof: false,
      exitStatus: null,
      pendingRequests: [],
    }
    this.#channels.set(localId, state)

    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_CHANNEL_OPEN)
    writer.writeString('session')
    writer.writeUint32(Number(localId) >>> 0)
    writer.writeUint32(initialWindow >>> 0)
    writer.writeUint32(maxPacketSize >>> 0)
    const payload = writer.toUint8Array()
    this.#recordDiagnostic(
      'info',
      'channel-open-send',
      'Sent SSH_MSG_CHANNEL_OPEN',
      {
        localId: Number(localId),
        type: request.type,
        initialWindow,
        maxPacketSize,
      },
    )
    this.#sendPacket(payload)
  }

  #handleCommandSendChannelData(channelId: ChannelId, data: Uint8Array): void {
    if (data.length === 0) {
      return
    }
    const state = this.#requireChannel(channelId)
    if (state.status !== 'open') {
      throw new SshProtocolError(
        `Channel ${Number(channelId)} is not ready to send data`,
      )
    }
    if (state.remoteId === null) {
      throw new SshInvariantViolation(
        `Channel ${Number(channelId)} is missing remote identifier`,
      )
    }
    if (data.length > state.outboundWindow) {
      throw new SshProtocolError('Channel remote window exhausted')
    }
    if (
      state.maxOutboundPacketSize > 0 &&
      data.length > state.maxOutboundPacketSize
    ) {
      throw new SshProtocolError('Channel data exceeds remote max packet size')
    }

    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_CHANNEL_DATA)
    writer.writeUint32(state.remoteId >>> 0)
    writer.writeUint32(data.length >>> 0)
    writer.writeBytes(data)
    this.#sendPacket(writer.toUint8Array())

    state.outboundWindow -= data.length
  }

  #handleCommandAdjustWindow(channelId: ChannelId, delta: number): void {
    if (delta <= 0) {
      throw new SshProtocolError('Window adjust delta must be positive')
    }
    const state = this.#requireChannel(channelId)
    if (state.remoteId === null) {
      throw new SshInvariantViolation(
        `Channel ${Number(channelId)} is missing remote identifier`,
      )
    }
    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_CHANNEL_WINDOW_ADJUST)
    writer.writeUint32(state.remoteId >>> 0)
    writer.writeUint32(delta >>> 0)
    this.#sendPacket(writer.toUint8Array())

    const newWindow = state.inboundWindow + delta
    state.inboundWindow = newWindow > 0xffff_ffff ? 0xffff_ffff : newWindow
  }

  #handleCommandChannelRequest(
    channelId: ChannelId,
    request: ChannelRequestPayload,
  ): void {
    const state = this.#requireChannel(channelId)
    if (state.remoteId === null) {
      throw new SshInvariantViolation(
        `Channel ${Number(channelId)} is missing remote identifier`,
      )
    }
    if (state.status !== 'open' && state.status !== 'closing') {
      throw new SshProtocolError(
        `Channel ${Number(channelId)} is not ready for requests`,
      )
    }

    const writer = new BinaryWriter()
    writer.writeUint8(SSH_MSG_CHANNEL_REQUEST)
    writer.writeUint32(state.remoteId >>> 0)
    const metadata = this.#resolveChannelRequestMetadata(request)
    writer.writeString(metadata.name)
    writer.writeBoolean(metadata.wantReply)
    this.#encodeChannelRequestPayload(writer, request)
    this.#recordDiagnostic(
      'debug',
      'channel-request-send',
      'Sent channel request',
      {
        channel: Number(channelId),
        requestType: metadata.name,
        wantReply: metadata.wantReply,
      },
    )
    this.#sendPacket(writer.toUint8Array())

    if (metadata.wantReply) {
      state.pendingRequests.push({
        requestType: metadata.name,
        request,
      })
    }
  }

  #handleCommandCloseChannel(channelId: ChannelId): void {
    const state = this.#requireChannel(channelId)
    if (state.remoteId !== null && state.status !== 'closed') {
      const writer = new BinaryWriter()
      writer.writeUint8(SSH_MSG_CHANNEL_CLOSE)
      writer.writeUint32(state.remoteId >>> 0)
      this.#sendPacket(writer.toUint8Array())
    }
    state.status = 'closing'
  }

  #resolveChannelRequestMetadata(request: ChannelRequestPayload): {
    name: string
    wantReply: boolean
  } {
    const defaultWantReply = ((): boolean => {
      switch (request.type) {
        case 'pty-req':
          return true
        case 'shell':
          return true
        case 'exec':
          return true
      }
    })()
    const wantReply = request.wantReply ?? defaultWantReply
    switch (request.type) {
      case 'pty-req':
        return { name: 'pty-req', wantReply }
      case 'shell':
        return { name: 'shell', wantReply }
      case 'exec':
        return { name: 'exec', wantReply }
      default: {
        const exhaustive: never = request
        throw new SshNotImplementedError(
          `Channel request ${(exhaustive as { type: string }).type} is not supported`,
        )
      }
    }
  }

  #encodeChannelRequestPayload(
    writer: BinaryWriter,
    request: ChannelRequestPayload,
  ): void {
    switch (request.type) {
      case 'pty-req': {
        const term = request.term ?? 'xterm-256color'
        const widthChars = request.columns >>> 0
        const heightChars = request.rows >>> 0
        const widthPixels = (request.widthPixels ?? 0) >>> 0
        const heightPixels = (request.heightPixels ?? 0) >>> 0
        const modes = request.modes ?? Uint8Array.of(0)
        writer.writeString(term)
        writer.writeUint32(widthChars)
        writer.writeUint32(heightChars)
        writer.writeUint32(widthPixels)
        writer.writeUint32(heightPixels)
        writer.writeUint32(modes.length >>> 0)
        writer.writeBytes(modes)
        return
      }
      case 'shell':
        return
      case 'exec':
        writer.writeString(request.command)
        return
      default: {
        const exhaustive: never = request
        throw new SshNotImplementedError(
          `Channel request ${(exhaustive as { type: string }).type} payload unsupported`,
        )
      }
    }
  }

  #handleChannelRequestSuccess(reader: BinaryReader): void {
    const recipient = reader.readUint32()
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-request-success-unknown',
        `CHANNEL_SUCCESS for unknown channel ${recipient}`,
      )
      return
    }
    const pending = state.pendingRequests.shift()
    const requestType = pending?.requestType ?? 'unknown'
    this.#recordDiagnostic(
      'info',
      'channel-request-success',
      'Server accepted channel request',
      {
        channel: Number(state.localId),
        requestType,
      },
    )
    this.#emit({
      type: 'channel-request',
      channelId: state.localId,
      requestType,
      status: 'success',
      request: pending?.request,
    })
  }

  #handleChannelRequestFailure(reader: BinaryReader): void {
    const recipient = reader.readUint32()
    const state = this.#channels.get(recipient as ChannelId)
    if (!state) {
      this.#emitWarning(
        'channel-request-failure-unknown',
        `CHANNEL_FAILURE for unknown channel ${recipient}`,
      )
      return
    }
    const pending = state.pendingRequests.shift()
    const requestType = pending?.requestType ?? 'unknown'
    this.#recordDiagnostic(
      'warn',
      'channel-request-failure',
      'Server rejected channel request',
      {
        channel: Number(state.localId),
        requestType,
      },
    )
    this.#emit({
      type: 'channel-request',
      channelId: state.localId,
      requestType,
      status: 'failure',
      request: pending?.request,
    })
  }

  #collectChannelSnapshots(): ChannelSnapshot[] {
    return Array.from(this.#channels.values()).map((state) =>
      this.#channelSnapshotFromState(state),
    )
  }

  #channelDescriptorFromState(state: ChannelState): ChannelDescriptor {
    return {
      localId: state.localId,
      remoteId: state.remoteId,
      type: state.type,
      windowSize: state.outboundWindow,
      maxPacketSize: state.maxOutboundPacketSize,
    }
  }

  #channelSnapshotFromState(state: ChannelState): ChannelSnapshot {
    return {
      ...this.#channelDescriptorFromState(state),
      status: state.status,
    }
  }

  #allocateChannelId(): ChannelId {
    const next = this.#nextChannelId >>> 0
    if (next >= 0xffff_ffff) {
      throw new SshInvariantViolation('Exhausted client channel identifiers')
    }
    this.#nextChannelId = (next + 1) >>> 0
    return next as ChannelId
  }

  #defaultChannelInitialWindow(): number {
    return (
      this.#config.channels?.initialWindowSize ?? DEFAULT_CHANNEL_INITIAL_WINDOW
    )
  }

  #defaultChannelMaxPacketSize(): number {
    return (
      this.#config.channels?.maxPacketSize ?? DEFAULT_CHANNEL_MAX_PACKET_SIZE
    )
  }

  #requireChannel(channelId: ChannelId): ChannelState {
    const state = this.#channels.get(channelId)
    if (!state) {
      throw new SshProtocolError(
        `Channel ${Number(channelId)} is not registered`,
      )
    }
    return state
  }

  #parseHostKey(hostKey: Uint8Array): {
    algorithm: string
    publicKey: Uint8Array
  } {
    const reader = new BinaryReader(hostKey)
    const algorithm = reader.readString()
    const length = reader.readUint32()
    const publicKey = reader.readBytes(length)
    if (reader.remaining > 0) {
      this.#emitWarning(
        'host-key-extra-bytes',
        'Host key blob contained trailing data',
      )
    }
    return { algorithm, publicKey }
  }

  #parseSignature(signature: Uint8Array): {
    algorithm: string
    signature: Uint8Array
  } {
    const reader = new BinaryReader(signature)
    const algorithm = reader.readString()
    const length = reader.readUint32()
    const rawSignature = reader.readBytes(length)
    if (reader.remaining > 0) {
      this.#emitWarning(
        'signature-extra-bytes',
        'Signature blob contained trailing data',
      )
    }
    return { algorithm, signature: rawSignature }
  }

  #enqueueOutbound(packet: Uint8Array, encryption: CipherStateLabel): void {
    this.#outboundPackets.push(packet)
    this.#emit({ type: 'outbound-data', payload: packet, encryption })
  }

  #queueTask(task: () => Promise<void> | void): void {
    this.#taskQueue = this.#taskQueue
      .then(async () => {
        if (this.#closed) {
          return
        }
        await task()
      })
      .catch((error) => {
        this.#handleAsyncError(error)
      })
  }

  #handleAsyncError(error: unknown): void {
    if (this.#closed) {
      return
    }
    this.#phase = 'failed'
    this.#recordDiagnostic(
      'error',
      'async-failure',
      'Asynchronous SSH task failed',
      {
        error,
      },
    )
    this.#emit({
      type: 'warning',
      code: 'async-failure',
      message: 'SSH session aborted due to internal error',
      detail: error instanceof Error ? error.message : error,
    })
    this.close({
      code: 2,
      description: 'Protocol failure',
    })
  }

  #emit(event: SshEvent): void {
    if (this.#closed) {
      return
    }
    this.#syncEvents.push(event)
    this.#eventQueue.push(event)
  }

  #emitWarning(code: string, message: string, detail?: unknown): void {
    this.#recordDiagnostic('warn', code, message, detail)
    this.#emit({ type: 'warning', code, message, detail })
  }

  #recordDiagnostic(
    level: DiagnosticRecord['level'],
    code: string,
    message: string,
    detail?: unknown,
  ): void {
    if (!this.#config.diagnostics) {
      return
    }
    this.#config.diagnostics.onRecord({
      timestamp: this.#config.clock(),
      level,
      code,
      message,
      detail,
    })
  }

  #assertActive(): void {
    if (this.#closed) {
      throw new SshInvariantViolation('Cannot operate on a closed session')
    }
  }
}

export function createClientSession(config: SshClientConfig): SshSession {
  return new ClientSessionImpl(config)
}
