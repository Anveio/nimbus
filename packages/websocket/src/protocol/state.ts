import type { DiagnosticEvent } from './diagnostics'

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'closed'

export interface ChannelState {
  readonly id: number
  readonly status: 'opening' | 'ready' | 'closed'
  readonly resumeKey?: string
}

export interface ResumeState {
  readonly token?: string
  readonly ttlMs: number
  readonly expiresAt?: number
}

export interface ConnectionState {
  readonly phase: ConnectionPhase
  readonly channels: Map<number, ChannelState>
  readonly heartbeatMisses: number
  readonly heartbeatThreshold: number
  readonly lastPingAt?: number
  readonly handshakeAttempts: number
  readonly diagnostics: readonly DiagnosticEvent[]
  readonly resume?: ResumeState
  readonly serverCaps?: Readonly<Record<string, unknown>>
  readonly serverName?: string
}

export type ConnectionEvent =
  | { readonly type: 'connect_requested' }
  | { readonly type: 'socket_opened' }
  | {
      readonly type: 'hello_sent'
      readonly resumeToken?: string
      readonly profileRequested?: string
      readonly timestamp?: number
    }
  | {
      readonly type: 'hello_ok'
      readonly serverName: string
      readonly serverCaps: Readonly<Record<string, unknown>>
    }
  | { readonly type: 'authentication_succeeded' }
  | {
      readonly type: 'authentication_failed'
      readonly reason: string
      readonly appCode?: number
    }
  | {
      readonly type: 'resume_succeeded'
      readonly token: string
      readonly timestamp?: number
    }
  | {
      readonly type: 'resume_failed'
      readonly token?: string
      readonly code: string
      readonly timestamp?: number
    }
  | { readonly type: 'heartbeat_sent'; readonly timestamp: number }
  | { readonly type: 'heartbeat_ack'; readonly timestamp: number }
  | { readonly type: 'heartbeat_miss'; readonly timestamp: number }
  | { readonly type: 'network_drop' }
  | { readonly type: 'reconnect_attempt' }
  | { readonly type: 'reconnected' }
  | {
      readonly type: 'connection_closed'
      readonly wsCode?: number
      readonly appCode?: number
      readonly reason?: string
      readonly timestamp?: number
    }
  | { readonly type: 'channel_open'; readonly channelId: number }
  | {
      readonly type: 'channel_open_ok'
      readonly channelId: number
      readonly resumeKey?: string
    }
  | { readonly type: 'channel_closed'; readonly channelId: number }

export interface ConnectionStateMachine {
  readonly state: ConnectionState
  dispatch(
    event: ConnectionEvent,
    opts?: { readonly now?: number },
  ): ConnectionState
}

export function createInitialConnectionState(opts?: {
  readonly heartbeatThreshold?: number
  readonly resume?: ResumeState
}): ConnectionState {
  return {
    phase: 'idle',
    channels: new Map(),
    heartbeatMisses: 0,
    heartbeatThreshold: opts?.heartbeatThreshold ?? 3,
    lastPingAt: undefined,
    handshakeAttempts: 0,
    diagnostics: [],
    resume: opts?.resume,
    serverCaps: undefined,
    serverName: undefined,
  }
}

export function createConnectionStateMachine(
  initial?: ConnectionState,
): ConnectionStateMachine {
  let state = initial ?? createInitialConnectionState()
  return {
    get state() {
      return state
    },
    dispatch(event, opts) {
      state = reduceConnection(state, event, opts?.now ?? Date.now())
      return state
    },
  }
}

export function reduceConnection(
  state: ConnectionState,
  event: ConnectionEvent,
  now: number,
): ConnectionState {
  switch (event.type) {
    case 'connect_requested':
      return { ...state, phase: 'connecting' }
    case 'socket_opened':
      return { ...state, phase: 'authenticating', heartbeatMisses: 0 }
    case 'hello_sent': {
      const handshakeAttempts = state.handshakeAttempts + 1
      const diagnostics = state.diagnostics.concat({
        type: 'handshake',
        attempt: handshakeAttempts,
        timestamp: event.timestamp ?? now,
        resumeTokenPresent: Boolean(event.resumeToken ?? state.resume?.token),
        profileRequested: event.profileRequested,
      })
      const resume = event.resumeToken
        ? {
            ...(state.resume ?? { ttlMs: 60_000 }),
            token: event.resumeToken,
          }
        : state.resume
      if (event.resumeToken) {
        const tokenHash = obfuscateToken(event.resumeToken)
        const diag: DiagnosticEvent = {
          type: 'resume_attempt',
          timestamp: event.timestamp ?? now,
          tokenHash,
        }
        return {
          ...state,
          handshakeAttempts,
          diagnostics: diagnostics.concat(diag),
          resume,
        }
      }
      return { ...state, handshakeAttempts, diagnostics, resume }
    }
    case 'hello_ok':
      return {
        ...state,
        phase: 'authenticating',
        serverName: event.serverName,
        serverCaps: event.serverCaps,
      }
    case 'authentication_succeeded':
      return {
        ...state,
        phase: 'ready',
        heartbeatMisses: 0,
      }
    case 'authentication_failed': {
      const diagnostics = state.diagnostics.concat({
        type: 'close',
        timestamp: now,
        phase: state.phase,
        appCode: event.appCode,
        reason: event.reason,
      })
      return {
        ...state,
        phase: 'closed',
        diagnostics,
      }
    }
    case 'resume_succeeded': {
      const tokenHash = obfuscateToken(event.token)
      const diagnostics = state.diagnostics.concat({
        type: 'resume_success',
        tokenHash,
        timestamp: event.timestamp ?? now,
      })
      return {
        ...state,
        resume: {
          ...(state.resume ?? { ttlMs: 60_000 }),
          token: event.token,
        },
        diagnostics,
      }
    }
    case 'resume_failed': {
      const diagnostics = state.diagnostics.concat({
        type: 'resume_failure',
        timestamp: event.timestamp ?? now,
        tokenHash: event.token ? obfuscateToken(event.token) : undefined,
        code: event.code,
      })
      return {
        ...state,
        phase: 'closed',
        diagnostics,
      }
    }
    case 'heartbeat_sent':
      return { ...state, lastPingAt: event.timestamp }
    case 'heartbeat_ack': {
      const rtt =
        state.lastPingAt !== undefined
          ? Math.max(0, event.timestamp - state.lastPingAt)
          : 0
      const diagnostics = state.diagnostics.concat({
        type: 'ping',
        timestamp: event.timestamp,
        rttMs: rtt,
        misses: 0,
      })
      return {
        ...state,
        lastPingAt: undefined,
        heartbeatMisses: 0,
        diagnostics,
      }
    }
    case 'heartbeat_miss': {
      const misses = state.heartbeatMisses + 1
      if (misses < state.heartbeatThreshold) {
        return { ...state, heartbeatMisses: misses }
      }
      const diagnostics = state.diagnostics.concat({
        type: 'heartbeat_timeout',
        timestamp: event.timestamp,
        threshold: state.heartbeatThreshold,
        misses,
      })
      return {
        ...state,
        phase: 'reconnecting',
        heartbeatMisses: misses,
        diagnostics,
      }
    }
    case 'network_drop':
      return {
        ...state,
        phase: 'reconnecting',
      }
    case 'reconnect_attempt':
      return {
        ...state,
        phase: 'reconnecting',
      }
    case 'reconnected':
      return {
        ...state,
        phase: 'authenticating',
        heartbeatMisses: 0,
      }
    case 'connection_closed': {
      const diagnostics = state.diagnostics.concat({
        type: 'close',
        timestamp: event.timestamp ?? now,
        wsCode: event.wsCode,
        appCode: event.appCode,
        reason: event.reason,
        phase: state.phase,
      })
      return {
        ...state,
        phase: 'closed',
        diagnostics,
      }
    }
    case 'channel_open': {
      if (state.channels.has(event.channelId)) return state
      const channels = new Map(state.channels)
      channels.set(event.channelId, {
        id: event.channelId,
        status: 'opening',
      })
      return { ...state, channels }
    }
    case 'channel_open_ok': {
      const current = state.channels.get(event.channelId)
      if (!current) return state
      const channels = new Map(state.channels)
      channels.set(event.channelId, {
        id: event.channelId,
        status: 'ready',
        resumeKey: event.resumeKey ?? current.resumeKey,
      })
      return { ...state, channels }
    }
    case 'channel_closed': {
      if (!state.channels.has(event.channelId)) return state
      const channels = new Map(state.channels)
      channels.set(event.channelId, {
        id: event.channelId,
        status: 'closed',
        resumeKey: state.channels.get(event.channelId)?.resumeKey,
      })
      return { ...state, channels }
    }
    default:
      return state
  }
}

function obfuscateToken(token: string): string {
  let hash = 0
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 33 + token.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
