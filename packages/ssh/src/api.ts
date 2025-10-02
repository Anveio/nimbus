import {
  SshInvariantViolation,
  SshNotImplementedError,
  SshProtocolError,
} from './errors'
import { AsyncEventQueue } from './internal/async-event-queue'
import { BinaryReader } from './internal/binary/binary-reader'
import { BinaryWriter } from './internal/binary/binary-writer'

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
  remember?(candidate: HostKeyCandidate, decision: HostKeyDecision): Promise<void> | void
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
  onEvent(event: AuthenticationEvent, toolkit: AuthenticationToolkit): void | Promise<void>
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
  readonly status: 'open' | 'closing' | 'closed'
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
  | { readonly type: 'channel-eof'; readonly channelId: ChannelId }
  | {
      readonly type: 'channel-close'
      readonly channelId: ChannelId
      readonly exitStatus?: number
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
}

const ASCII_ENCODER = new TextEncoder()
const ASCII_DECODER = new TextDecoder('utf-8', { fatal: false })
const SSH_MSG_KEXINIT = 20
const MIN_PADDING_LENGTH = 4
const SSH_PACKET_BLOCK_SIZE = 8
const MAX_IDENTIFICATION_LENGTH = 255

function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

class ClientSessionImpl implements SshSession {
  readonly events: AsyncIterable<SshEvent>

  #config: SshClientConfig
  #phase: SessionPhase = 'initial'
  #eventQueue = new AsyncEventQueue<SshEvent>()
  #syncEvents: SshEvent[] = []
  #outboundPackets: Uint8Array[] = []
  #closed = false

  #prefaceBuffer: Uint8Array = new Uint8Array(0)
  #binaryBuffer: Uint8Array = new Uint8Array(0)
  #serverIdentification: string | null = null
  #kexInitSent = false
  #kexInitReceived = false
  #negotiatedAlgorithms: NegotiatedAlgorithms | null = null

  constructor(config: SshClientConfig) {
    this.#config = config
    this.events = this.#eventQueue
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

  command(_intent: ClientIntent): void {
    this.#assertActive()
    throw new SshNotImplementedError('command() will be implemented in a later phase')
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

  inspect(): SshSessionSnapshot {
    return {
      phase: this.#phase,
      negotiatedAlgorithms: this.#negotiatedAlgorithms,
      pendingOutboundPackets: this.#outboundPackets.length,
      openChannels: [],
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
    const { clientId } = this.#config.identification
    if (!clientId.startsWith('SSH-')) {
      throw new SshInvariantViolation('Client identification string must begin with "SSH-"')
    }
    if (clientId.length > MAX_IDENTIFICATION_LENGTH) {
      throw new SshInvariantViolation('Client identification string exceeds 255 characters')
    }
    const line = clientId.endsWith('\n')
      ? clientId
      : `${clientId}${clientId.endsWith('\r') ? '\n' : '\r\n'}`
    const payload = ASCII_ENCODER.encode(line)

    this.#phase = 'identification'
    this.#emit({ type: 'identification-sent', clientId })
    this.#enqueueOutbound(payload, 'initial')
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
        this.#recordDiagnostic('debug', 'preface-line', 'Ignored server preface line', { line })
        continue
      }
      if (line.length > MAX_IDENTIFICATION_LENGTH) {
        throw new SshProtocolError('Server identification string exceeds 255 characters')
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
    while (this.#binaryBuffer.length >= 5) {
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
      const totalLength = 4 + packetLength
      if (this.#binaryBuffer.length < totalLength) {
        return
      }
      const paddingLengthByte = this.#binaryBuffer[4]
      if (paddingLengthByte === undefined) {
        throw new SshProtocolError('SSH packet missing padding length byte')
      }
      const paddingLength = paddingLengthByte
      if (paddingLength < MIN_PADDING_LENGTH) {
        throw new SshProtocolError(
          `SSH packet padding length ${paddingLength} violates minimum ${MIN_PADDING_LENGTH}`,
        )
      }
      const payloadLength = packetLength - paddingLength - 1
      if (payloadLength < 0) {
        throw new SshProtocolError('SSH packet payload length underflow detected')
      }

      const payloadStart = 5
      const payloadEnd = payloadStart + payloadLength
      const payload = this.#binaryBuffer.slice(payloadStart, payloadEnd)
      this.#binaryBuffer = this.#binaryBuffer.slice(totalLength)

      this.#handlePayload(payload)
    }
  }

  #handlePayload(payload: Uint8Array): void {
    const reader = new BinaryReader(payload)
    const messageId = reader.readUint8()
    if (messageId === SSH_MSG_KEXINIT) {
      this.#handleServerKexInit(reader)
      return
    }

    this.#emitWarning('unsupported-message', `Received unsupported SSH message ${messageId}`)
  }

  #handleServerKexInit(reader: BinaryReader): void {
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
      this.#emitWarning('first-kex-packet-follows', 'Server sent first_kex_packet_follows=true')
    }
    if (reserved !== 0) {
      this.#emitWarning('nonzero-reserved', 'Server set non-zero reserved value in KEXINIT', reserved)
    }
    if (!this.#kexInitSent) {
      this.#ensureKexInitSent()
    }

    const summary: NegotiationSummary = {
      client: this.#clientKexAlgorithms(),
      server: serverKex,
    }
    this.#emit({ type: 'kex-init-received', summary })
    this.#recordDiagnostic('info', 'kex-init-received', 'Received SSH_MSG_KEXINIT', {
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
    })

    this.#kexInitReceived = true
    this.#phase = 'kex'
  }

  #ensureKexInitSent(): void {
    if (this.#kexInitSent) {
      return
    }

    const payload = this.#buildClientKexInitPayload()
    const packet = this.#wrapPacket(payload)
    const summary: NegotiationSummary = {
      client: this.#clientKexAlgorithms(),
    }

    this.#kexInitSent = true
    this.#emit({ type: 'kex-init-sent', summary })
    this.#recordDiagnostic('info', 'kex-init-sent', 'Sent SSH_MSG_KEXINIT', summary)
    this.#enqueueOutbound(packet, 'initial')
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

    return writer.toUint8Array()
  }

  #wrapPacket(payload: Uint8Array): Uint8Array {
    let paddingLength = MIN_PADDING_LENGTH
    while ((payload.length + paddingLength + 1) % SSH_PACKET_BLOCK_SIZE !== 0) {
      paddingLength += 1
    }
    if (paddingLength > 255) {
      throw new SshInvariantViolation('Computed SSH padding length exceeds 255 bytes')
    }

    const packetLength = payload.length + paddingLength + 1
    const writer = new BinaryWriter()
    writer.writeUint32(packetLength)
    writer.writeUint8(paddingLength)
    writer.writeBytes(payload)
    writer.writeBytes(this.#config.randomBytes(paddingLength))
    return writer.toUint8Array()
  }

  #clientKexAlgorithms(): ReadonlyArray<string> {
    const { algorithms } = this.#config
    const list: string[] = [...algorithms.keyExchange]
    if (algorithms.extensions?.length) {
      list.push(...algorithms.extensions)
    }
    return list
  }

  #enqueueOutbound(packet: Uint8Array, encryption: CipherStateLabel): void {
    this.#outboundPackets.push(packet)
    this.#emit({ type: 'outbound-data', payload: packet, encryption })
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
