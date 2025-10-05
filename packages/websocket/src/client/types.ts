import type { WireProfile } from '../protocol'

export type AuthProvider = () => Promise<AuthToken>

export type AuthToken =
  | { readonly scheme: 'bearer'; readonly token: string }
  | { readonly scheme: 'none' }

export interface RetryOptions {
  readonly strategy: 'exponential'
  readonly maxRetries?: number
  readonly baseMs?: number
  readonly jitter?: boolean
}

export interface ResumeOptions {
  readonly storage: 'session' | 'memory' | 'none'
  readonly ttlMs?: number
}

export interface ResumePersistState {
  readonly token: string
  readonly expiresAt?: number
  readonly channels?: ReadonlyArray<{
    readonly id: number
    readonly window: number
  }>
}

export interface ResumeHooks {
  readonly enable?: boolean
  onPersist?(state: ResumePersistState): void | Promise<void>
  onLoad?():
    | ResumePersistState
    | undefined
    | Promise<ResumePersistState | undefined>
  onClear?(): void | Promise<void>
}

export interface ClientInfo {
  readonly app?: string
  readonly version?: string
}

export interface ConnectOptions {
  readonly url: string
  readonly profile?: string | WireProfile
  readonly auth?: AuthProvider
  readonly retry?: RetryOptions
  readonly highWaterMark?: number
  readonly lowWaterMark?: number
  readonly resume?: ResumeOptions
  readonly resumeHooks?: ResumeHooks
  readonly transport?: 'auto' | 'websocket' | 'websocketstream'
  readonly clientInfo?: ClientInfo
  readonly node?: NodeExtras
}

export interface NodeExtras {
  readonly perMessageDeflate?:
    | false
    | {
        readonly serverNoContextTakeover?: boolean
        readonly clientNoContextTakeover?: boolean
        readonly serverMaxWindowBits?: number
        readonly clientMaxWindowBits?: number
      }
}

export type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
) => unknown

export type ConnectionState =
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'closed'

export type ConnectionEventName = 'statechange' | 'diagnostic' | 'policy'

export type ConnectionEvents = {
  readonly statechange: readonly [ConnectionState]
  readonly diagnostic: readonly [unknown]
  readonly policy: readonly [unknown]
}

export type ChannelEvents = {
  readonly data: readonly [Uint8Array]
  readonly stderr: readonly [Uint8Array]
  readonly exit: readonly [{ readonly code?: number; readonly sig?: string }]
  readonly error: readonly [Error]
}

export interface Channel {
  readonly id: number
  on<E extends keyof ChannelEvents>(
    event: E,
    listener: (...args: ChannelEvents[E]) => void,
  ): () => void
  send(data: Uint8Array): Promise<void>
  resize(size: { readonly cols: number; readonly rows: number }): void
  signal(sig: string): Promise<void>
  close(reason?: string): Promise<void>
}

export interface Connection {
  readonly protocol: string
  readonly state: ConnectionState
  on<E extends keyof ConnectionEvents>(
    event: E,
    listener: (...args: ConnectionEvents[E]) => void,
  ): () => void
  openSession(init: {
    target: { readonly host: string; readonly port: number }
    user: { readonly username: string; readonly auth: unknown }
    term?: {
      readonly cols: number
      readonly rows: number
      readonly env?: Readonly<Record<string, string>>
    }
  }): Promise<Channel>
  close(code?: number, reason?: string): Promise<void>
}
