import { SshInvariantViolation, SshNotImplementedError } from './errors'
import { AsyncEventQueue } from './internal/async-event-queue'

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

class ClientSessionImpl implements SshSession {
  readonly events: AsyncIterable<SshEvent>

  #config: SshClientConfig
  #phase: SessionPhase = 'initial'
  #eventQueue = new AsyncEventQueue<SshEvent>()
  #syncEvents: SshEvent[] = []
  #outboundPackets: Uint8Array[] = []
  #closed = false

  constructor(config: SshClientConfig) {
    this.#config = config
    this.events = this.#eventQueue
  }

  receive(_chunk: Uint8Array): void {
    this.#assertActive()
    throw new SshNotImplementedError('receive() will be implemented in Phase 1')
  }

  command(_intent: ClientIntent): void {
    this.#assertActive()
    throw new SshNotImplementedError('command() will be implemented in Phase 2')
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
      negotiatedAlgorithms: null,
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

  #assertActive(): void {
    if (this.#closed) {
      throw new SshInvariantViolation('Cannot operate on a closed session')
    }
  }
}

export function createClientSession(config: SshClientConfig): SshSession {
  return new ClientSessionImpl(config)
}
