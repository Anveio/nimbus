export type SessionTransport = 'echo' | 'ssh-websocket'

export interface SessionOpenOptions {
  readonly transport?: SessionTransport
  readonly target?: {
    readonly host: string
    readonly port: number
  }
  readonly websocket?: {
    readonly url: string
    readonly profile?: string
  }
  readonly credentials?: {
    readonly username: string
    readonly password?: string
    readonly privateKey?: string
  }
  readonly terminal?: {
    readonly columns?: number
    readonly rows?: number
  }
}

export type SessionStatus =
  | { readonly type: 'idle' }
  | { readonly type: 'connecting' }
  | { readonly type: 'connected' }
  | { readonly type: 'ready' }
  | { readonly type: 'closed'; readonly reason?: string }
  | { readonly type: 'error'; readonly message: string }

export interface SessionDiagnostic {
  readonly level: 'info' | 'warn' | 'error'
  readonly code: string
  readonly message: string
  readonly detail?: unknown
}

export interface SessionResize {
  readonly columns: number
  readonly rows: number
}
