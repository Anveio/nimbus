import { createEventBus, type EventBus } from '../../client/internal/event-bus'
import type { RuntimeWebSocket } from '../../client/internal/socket'
import { adaptWebSocket } from '../../client/internal/socket'
import type { Ctl, DataFrame, WireProfile } from '../../protocol'
import {
  ensureDefaultProfiles,
  lenPrefixedV1Profile,
  nimbusV1Profile,
} from '../../protocol'

export interface ServerPolicyEvent {
  readonly type: 'flow_violation' | 'protocol_error'
  readonly code: string
  readonly detail?: unknown
}

export interface ServerDiagnosticEvent {
  readonly type: 'handshake' | 'channel_open' | 'channel_close' | 'error'
  readonly detail?: unknown
}

export type ServerEvents = {
  readonly policy: readonly [ServerPolicyEvent]
  readonly diagnostic: readonly [ServerDiagnosticEvent]
}

export interface ChannelOpenRequest {
  readonly id: number
  readonly target: { readonly host: string; readonly port: number }
  readonly user: { readonly username: string; readonly auth: unknown }
  readonly term?: {
    readonly cols: number
    readonly rows: number
    readonly env?: Readonly<Record<string, string>>
  }
}

export interface ChannelApi {
  write(data: Uint8Array, stream?: 'stdout' | 'stderr'): void
  exit(payload: { readonly code?: number; readonly sig?: string }): void
  close(reason?: string): void
}

export interface ServerConnectionOptions {
  readonly socket: unknown
  readonly serverName: string
  readonly maxFrame?: number
  readonly windowTarget?: number
  readonly onChannelOpen?: (
    request: ChannelOpenRequest,
    api: ChannelApi,
  ) => void | Promise<void>
  readonly events?: EventBus<ServerEvents>
}

interface ChannelState {
  readonly id: number
  credit: number
  readonly queue: Array<{
    readonly payload: Uint8Array
    readonly stream: 'stdout' | 'stderr'
  }>
  readonly api: ChannelApi
  openResolved: boolean
}

export class ServerConnection {
  readonly socket: RuntimeWebSocket
  readonly events: EventBus<ServerEvents>
  private readonly wireProfile: WireProfile
  private readonly channels = new Map<number, ChannelState>()
  private nextResumeKey = 1

  constructor(private readonly options: ServerConnectionOptions) {
    ensureDefaultProfiles()
    this.socket = adaptWebSocket(options.socket)
    this.events = options.events ?? createEventBus<ServerEvents>()
    this.wireProfile = resolveProfile(options)
    this.bind()
  }

  private bind(): void {
    this.socket.addEventListener('message', (event) => {
      this.handleIncoming(event.data)
    })
    this.socket.addEventListener('close', () => {
      for (const [, channel] of this.channels) {
        channel.api.close('connection_closed')
      }
      this.channels.clear()
    })
  }

  private handleIncoming(payload: unknown): void {
    const ctl = this.wireProfile.decodeCtl(payload as never)
    if (ctl) {
      this.handleControl(ctl)
      return
    }
    const df = this.wireProfile.decodeData(payload as never)
    if (df) {
      this.handleData(df)
    }
  }

  private async handleControl(msg: Ctl): Promise<void> {
    switch (msg.t) {
      case 'hello':
        this.handleHello(msg)
        break
      case 'open':
        await this.handleOpen(msg)
        break
      case 'close':
        this.handleChannelClose(msg.id, msg.reason)
        break
      case 'flow':
        this.handleFlow(msg.id, msg.credit)
        break
      case 'ping':
        this.sendControl({ t: 'pong', ts: msg.ts })
        break
      default:
        break
    }
  }

  private handleHello(msg: Extract<Ctl, { t: 'hello' }>): void {
    const profileRequested =
      msg.caps && typeof msg.caps.profile === 'string'
        ? msg.caps.profile
        : undefined
    const profileAccepted = profileRequested ?? this.wireProfile.id
    const helloOk: Ctl = {
      t: 'hello_ok',
      server: this.options.serverName,
      caps: {
        flow: 'credit',
        maxFrame: this.options.maxFrame ?? 1_048_576,
        profileAccepted,
      },
    }
    this.sendControl(helloOk)
    this.events.emit('diagnostic', {
      type: 'handshake',
      detail: { profileAccepted },
    })
  }

  private async handleOpen(msg: Extract<Ctl, { t: 'open' }>): Promise<void> {
    if (this.channels.has(msg.id)) {
      this.events.emit('policy', {
        type: 'protocol_error',
        code: 'DUPLICATE_CHANNEL_ID',
        detail: { id: msg.id },
      })
      this.sendControl({
        t: 'open_err',
        id: msg.id,
        code: 'CHANNEL_EXISTS',
        msg: 'Channel already exists',
      })
      return
    }

    const resumeKey = `resume-${this.nextResumeKey++}`
    const state: ChannelState = {
      id: msg.id,
      credit: 0,
      queue: [],
      openResolved: false,
      api: {
        write: (data, stream = 'stdout') =>
          this.queueWrite(msg.id, data, stream),
        exit: (payload) => {
          this.sendControl({
            t: 'exit',
            id: msg.id,
            code: payload.code,
            sig: payload.sig,
          })
        },
        close: (reason) => {
          this.sendControl({ t: 'close', id: msg.id, reason })
        },
      },
    }
    this.channels.set(msg.id, state)

    this.sendControl({ t: 'open_ok', id: msg.id, resumeKey })
    this.events.emit('diagnostic', {
      type: 'channel_open',
      detail: { id: msg.id, resumeKey },
    })

    if (this.options.onChannelOpen) {
      await this.options.onChannelOpen(
        {
          id: msg.id,
          target: msg.target,
          user: msg.user,
          term: msg.term,
        },
        state.api,
      )
    }
    state.openResolved = true
  }

  private handleChannelClose(id: number, reason?: string): void {
    const channel = this.channels.get(id)
    if (!channel) return
    this.channels.delete(id)
    this.events.emit('diagnostic', {
      type: 'channel_close',
      detail: { id, reason },
    })
  }

  private handleFlow(id: number, credit: number): void {
    const channel = this.channels.get(id)
    if (!channel) return
    channel.credit += credit
    this.flushQueue(channel)
  }

  private handleData(frame: DataFrame): void {
    const channel = this.channels.get(frame.id)
    if (!channel) return
    channel.credit = Math.max(0, channel.credit - frame.payload.length)
  }

  private queueWrite(
    id: number,
    payload: Uint8Array,
    stream: 'stdout' | 'stderr',
  ): void {
    const channel = this.channels.get(id)
    if (!channel) return
    channel.queue.push({ payload, stream })
    this.flushQueue(channel)
  }

  private flushQueue(channel: ChannelState): void {
    while (channel.queue.length > 0 && channel.credit > 0) {
      const item = channel.queue[0]!
      if (item.payload.length > channel.credit) {
        break
      }
      this.sendData(channel.id, item.payload, item.stream)
      channel.credit -= item.payload.length
      channel.queue.shift()
    }
  }

  private sendControl(msg: Ctl): void {
    this.socket.send(this.wireProfile.encodeCtl(msg))
  }

  private sendData(
    id: number,
    payload: Uint8Array,
    stream: 'stdout' | 'stderr',
  ): void {
    const data: DataFrame = { id, payload, stream }
    const frames = this.wireProfile.encodeData(data, {
      maxFrame: this.options.maxFrame,
    })
    for (const frame of frames) {
      this.socket.send(frame)
    }
  }
}

function resolveProfile(options: ServerConnectionOptions): WireProfile {
  if (options.maxFrame && options.maxFrame > 8 * 1024 * 1024) {
    throw new Error('maxFrame exceeds supported limit (8 MiB)')
  }
  return options.maxFrame && options.maxFrame > 1_048_576
    ? lenPrefixedV1Profile
    : nimbusV1Profile
}
