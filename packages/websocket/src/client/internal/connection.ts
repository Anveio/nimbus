import type { Ctl, DataFrame, WireProfile } from '../../protocol'
import { ensureDefaultProfiles, getProfile } from '../../protocol'
import { registerChannel } from '../../protocol/flow'
import type {
  AuthProvider,
  Channel,
  ChannelEvents,
  Connection,
  ConnectionEvents,
  ConnectionState,
  ConnectOptions,
  ResumeHooks,
  ResumePersistState,
} from '../types'
import { createEventBus, type EventBus } from './event-bus'
import {
  applyInboundData,
  createProtocolHarness,
  type HarnessEvents,
  maybeGrantCredit,
  type ProtocolHarness,
} from './protocol-harness'
import { createResumeStore } from './resume-store'
import type { RuntimeWebSocket } from './socket'

interface PendingOpen {
  readonly resolve: (channel: Channel) => void
  readonly reject: (error: Error) => void
}

interface ChannelImpl extends Channel {
  readonly events: EventBus<ChannelEvents>
}

export interface ConnectionContext {
  readonly options: ConnectOptions
  readonly profile: WireProfile
  readonly socket: RuntimeWebSocket
  readonly harness: ProtocolHarness
  readonly events: EventBus<ConnectionEvents>
  readonly pendingOpens: Map<number, PendingOpen>
  readonly channels: Map<number, ChannelImpl>
  readonly authProvider?: AuthProvider
  readonly resumeStorage: ReturnType<typeof createResumeStore>
  readonly resumeTtlMs: number
  readonly resumeHooks?: ResumeHooks
}

export async function initialiseConnection(
  factory: () => Promise<RuntimeWebSocket>,
  options: ConnectOptions,
): Promise<Connection> {
  ensureDefaultProfiles()
  const profile = resolveProfile(options.profile)
  const events = createEventBus<ConnectionEvents>()
  const socket = await factory()
  const harnessEvents = createEventBus<HarnessEvents>()
  harnessEvents.on('statechange', (state) => events.emit('statechange', state))
  harnessEvents.on('diagnostic', (diag) => events.emit('diagnostic', diag))
  harnessEvents.on('policy', (policy) => events.emit('policy', policy))

  const harness = createProtocolHarness(socket, profile, harnessEvents, {
    highWaterMark: options.highWaterMark,
    lowWaterMark: options.lowWaterMark,
  })

  const resumeHooks =
    options.resumeHooks?.enable === false ? undefined : options.resumeHooks
  const resumeOptions = options.resume ?? { storage: 'session', ttlMs: 60_000 }
  const resumeStorage = createResumeStore(
    resumeOptions.storage ?? 'session',
    `nimbus.ws.${options.url}`,
  )
  const resumeTtlMs = resumeOptions.ttlMs ?? 60_000
  const seededToken = await seedResumeState({
    resumeHooks,
    resumeStorage,
    resumeTtlMs,
  })
  if (seededToken) {
    harness.update({ type: 'hello_sent', resumeToken: seededToken })
  }

  const normalizedOptions: ConnectOptions = { ...options }

  const context: ConnectionContext = {
    options: normalizedOptions,
    profile,
    socket,
    harness,
    events,
    channels: new Map(),
    pendingOpens: new Map(),
    authProvider: options.auth,
    resumeStorage,
    resumeTtlMs,
    resumeHooks,
  }

  attachSocketHandlers(context)
  harness.update({ type: 'connect_requested' })

  const readyPromise = new Promise<void>((resolve, reject) => {
    harnessEvents.on('statechange', (state) => {
      if (state === 'ready') {
        resolve()
      }
      if (state === 'closed') {
        reject(new Error('Connection closed during handshake'))
      }
    })
  })

  await readyPromise

  return createConnection(context)
}

function resolveProfile(profile: ConnectOptions['profile']): WireProfile {
  if (!profile) {
    const resolved = getProfile('nimbus.v1')
    if (!resolved) {
      throw new Error('Default wire profile nimbus.v1 is not registered')
    }
    return resolved
  }
  if (typeof profile === 'string') {
    const resolved = getProfile(profile)
    if (!resolved) {
      throw new Error(`Unknown wire profile '${profile}'`)
    }
    return resolved
  }
  return profile
}

function attachSocketHandlers(context: ConnectionContext): void {
  const {
    harness,
    profile,
    socket,
    events,
    options,
    authProvider,
    pendingOpens,
    resumeStorage,
  } = context

  const stopBufferedMonitor = startBufferedAmountMonitor(context)

  const handleOpen = async () => {
    harness.update({ type: 'socket_opened' })
    const auth = authProvider ? await authProvider() : undefined
    const resumeRecord = resumeStorage.get()
    const resume = resumeRecord ? { token: resumeRecord.token } : undefined
    const hello: Ctl = {
      t: 'hello',
      proto: 1,
      auth,
      caps: {
        profile: profile.id,
        clientInfo: options.clientInfo,
      },
      resume,
    }
    harness.sendControl(hello)
    harness.update({
      type: 'hello_sent',
      resumeToken: resume?.token,
      profileRequested: profile.id,
    })
  }

  socket.addEventListener('open', () => {
    handleOpen().catch((error) => {
      events.emit('diagnostic', {
        type: 'close',
        timestamp: Date.now(),
        reason: `auth/init failure: ${String(error)}`,
        phase: 'authenticating',
      })
      socket.close(1006, 'Internal error')
    })
  })

  socket.addEventListener('message', (event) => {
    handleIncoming(context, event.data)
  })

  socket.addEventListener('close', (event) => {
    harness.update({
      type: 'connection_closed',
      wsCode: event.code,
      reason: event.reason,
      timestamp: Date.now(),
    })
    stopBufferedMonitor()
    clearResumeState(context)
    for (const [, pending] of pendingOpens) {
      pending.reject(
        new Error(`Connection closed before channel ready (${event.code})`),
      )
    }
    pendingOpens.clear()
  })

  socket.addEventListener('error', (event) => {
    events.emit('diagnostic', {
      type: 'close',
      timestamp: Date.now(),
      reason: `WebSocket error: ${String((event as { error?: unknown }).error ?? 'unknown')}`,
      phase: harness.stateMachine.state.phase,
    })
  })
}

function handleIncoming(context: ConnectionContext, data: unknown): void {
  const { profile } = context
  const ctl = profile.decodeCtl(data as never)
  if (ctl) {
    handleControl(context, ctl)
    return
  }
  const df = profile.decodeData(data as never)
  if (df) {
    handleData(context, df)
  }
}

function handleControl(context: ConnectionContext, ctl: Ctl): void {
  const { harness, pendingOpens, channels } = context
  switch (ctl.t) {
    case 'hello_ok':
      harness.update({
        type: 'hello_ok',
        serverName: ctl.server,
        serverCaps: ctl.caps,
      })
      harness.update({ type: 'authentication_succeeded' })
      break
    case 'open_ok': {
      const pending = pendingOpens.get(ctl.id)
      const channel = channels.get(ctl.id)
      if (channel && pending) {
        harness.update({
          type: 'channel_open_ok',
          channelId: ctl.id,
          resumeKey: ctl.resumeKey,
        })
        maybeGrantCredit(harness, ctl.id)
        pending.resolve(channel)
        pendingOpens.delete(ctl.id)
        if (ctl.resumeKey) {
          persistResumeState(context, ctl.resumeKey)
        }
      }
      break
    }
    case 'open_err': {
      const pending = pendingOpens.get(ctl.id)
      if (pending) {
        pending.reject(new Error(`${ctl.code}: ${ctl.msg}`))
        pendingOpens.delete(ctl.id)
        channels.delete(ctl.id)
      }
      break
    }
    case 'exit': {
      const channel = channels.get(ctl.id)
      channel?.events.emit('exit', { code: ctl.code, sig: ctl.sig })
      break
    }
    case 'close': {
      const channel = channels.get(ctl.id)
      channel?.events.emit('error', new Error(ctl.reason ?? 'Channel closed'))
      harness.update({ type: 'channel_closed', channelId: ctl.id })
      channels.delete(ctl.id)
      break
    }
    case 'flow':
      // server granted credit, ignore for now
      break
    case 'pong':
      harness.update({ type: 'heartbeat_ack', timestamp: ctl.ts })
      break
    case 'ping':
      harness.sendControl({ t: 'pong', ts: ctl.ts })
      break
    default:
      break
  }
}

function handleData(context: ConnectionContext, frame: DataFrame): void {
  const channel = context.channels.get(frame.id)
  if (!channel) return
  applyInboundData(context.harness, frame.id, frame.payload.length)
  const payload = frame.payload
  if (frame.stream === 'stdout') {
    channel.events.emit('data', payload)
  } else {
    channel.events.emit('stderr', payload)
  }
  maybeGrantCredit(context.harness, frame.id)
}

function createConnection(context: ConnectionContext): Connection {
  let channelSequence = 1

  const openSession: Connection['openSession'] = async (init) => {
    const id = channelSequence++
    const nextFlow = registerChannel(context.harness.flow, id)
    context.harness.mutateFlow(nextFlow)
    const channelEvents = createEventBus<ChannelEvents>()

    const channel: ChannelImpl = {
      id,
      events: channelEvents,
      on(event, listener) {
        return channelEvents.on(event, listener)
      },
      async send(data) {
        const df: DataFrame = { stream: 'stdout', id, payload: data }
        context.harness.sendData(df)
      },
      resize(size) {
        context.harness.sendControl({
          t: 'resize',
          id,
          cols: size.cols,
          rows: size.rows,
        })
      },
      async signal(sig) {
        context.harness.sendControl({ t: 'signal', id, sig })
      },
      async close(reason) {
        context.harness.sendControl({ t: 'close', id, reason })
      },
    }

    context.channels.set(id, channel)

    const openMessage: Ctl = {
      t: 'open',
      id,
      target: init.target,
      user: init.user,
      term: init.term,
    }
    const ready = new Promise<Channel>((resolve, reject) => {
      context.pendingOpens.set(id, { resolve, reject })
    })

    context.harness.sendControl(openMessage)
    context.harness.update({ type: 'channel_open', channelId: id })

    return ready
  }

  const close: Connection['close'] = async (code, reason) => {
    context.socket.close(code, reason)
  }

  return {
    get protocol(): string {
      return (
        context.socket.protocol ||
        context.profile.subprotocols?.[0] ||
        context.profile.id
      )
    },
    get state(): ConnectionState {
      const phases: Record<string, ConnectionState> = {
        idle: 'connecting',
        connecting: 'connecting',
        authenticating: 'authenticating',
        ready: 'ready',
        reconnecting: 'reconnecting',
        closed: 'closed',
      }
      return phases[context.harness.stateMachine.state.phase] ?? 'connecting'
    },
    on(event, listener) {
      return context.events.on(event, listener)
    },
    openSession,
    close,
  }
}

async function seedResumeState(options: {
  readonly resumeHooks?: ResumeHooks
  readonly resumeStorage: ReturnType<typeof createResumeStore>
  readonly resumeTtlMs: number
}): Promise<string | undefined> {
  const { resumeHooks, resumeStorage, resumeTtlMs } = options
  if (resumeHooks?.onLoad) {
    const loaded = await resumeHooks.onLoad()
    if (loaded?.token) {
      const expiresAt = loaded.expiresAt ?? Date.now() + resumeTtlMs
      resumeStorage.set({ token: loaded.token, expiresAt })
    }
  }
  const record = resumeStorage.get()
  return record?.token
}

function persistResumeState(context: ConnectionContext, token: string): void {
  const expiresAt = Date.now() + context.resumeTtlMs
  context.resumeStorage.set({ token, expiresAt })
  const snapshot: ResumePersistState = {
    token,
    expiresAt,
    channels: collectChannelSnapshots(context),
  }
  void context.resumeHooks?.onPersist?.(snapshot)
}

function clearResumeState(context: ConnectionContext): void {
  context.resumeStorage.clear()
  void context.resumeHooks?.onClear?.()
}

function collectChannelSnapshots(
  context: ConnectionContext,
): ResumePersistState['channels'] {
  return Array.from(context.channels.values()).map((channel) => ({
    id: channel.id,
    window:
      context.harness.flow.channels.get(channel.id)?.creditOutstanding ?? 0,
  }))
}

function startBufferedAmountMonitor(context: ConnectionContext): () => void {
  const { socket, harness, events } = context
  if (typeof socket.bufferedAmount !== 'number') {
    return () => {}
  }
  const highWater = harness.flow.highWaterMark
  const lowWater = harness.flow.lowWaterMark
  let transportBackpressured = harness.flow.transportBackpressured

  const interval = setInterval(() => {
    const buffered = socket.bufferedAmount ?? 0
    if (!transportBackpressured && buffered >= highWater) {
      transportBackpressured = true
      harness.handleTransportBackpressure(true)
      events.emit('diagnostic', {
        type: 'buffer_state',
        timestamp: Date.now(),
        state: 'high',
        bufferedAmount: buffered,
        threshold: highWater,
      })
      return
    }
    if (transportBackpressured && buffered <= lowWater) {
      transportBackpressured = false
      harness.handleTransportBackpressure(false)
      events.emit('diagnostic', {
        type: 'buffer_state',
        timestamp: Date.now(),
        state: 'recovered',
        bufferedAmount: buffered,
        threshold: lowWater,
      })
    }
  }, 250)

  return () => clearInterval(interval)
}
