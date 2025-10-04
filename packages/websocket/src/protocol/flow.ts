import type {
  FlowPauseReason,
  FlowResumeReason,
  PolicyEvent,
} from './diagnostics'

export interface ChannelFlowState {
  readonly id: number
  readonly creditOutstanding: number
  readonly windowTarget: number
  readonly maxWindow: number
}

export interface FlowControllerState {
  readonly highWaterMark: number
  readonly lowWaterMark: number
  readonly transportBackpressured: boolean
  readonly visibilityHidden: boolean
  readonly offline: boolean
  readonly pausedReasons: ReadonlySet<FlowPauseReason>
  readonly channels: Map<number, ChannelFlowState>
}

export interface FlowUpdate {
  readonly state: FlowControllerState
  readonly policyEvents: readonly PolicyEvent[]
}

export interface CreditDecision extends FlowUpdate {
  readonly grant: number
}

export function createFlowController(opts?: {
  readonly highWaterMark?: number
  readonly lowWaterMark?: number
  readonly transportBackpressured?: boolean
  readonly visibilityHidden?: boolean
  readonly offline?: boolean
}): FlowControllerState {
  return {
    highWaterMark: opts?.highWaterMark ?? 8 * 1024 * 1024,
    lowWaterMark: opts?.lowWaterMark ?? 2 * 1024 * 1024,
    transportBackpressured: opts?.transportBackpressured ?? false,
    visibilityHidden: opts?.visibilityHidden ?? false,
    offline: opts?.offline ?? false,
    pausedReasons: computePausedReasons(
      opts?.transportBackpressured ?? false,
      opts?.visibilityHidden ?? false,
      opts?.offline ?? false,
    ),
    channels: new Map(),
  }
}

export function registerChannel(
  state: FlowControllerState,
  id: number,
  opts?: { readonly windowTarget?: number; readonly maxWindow?: number },
): FlowControllerState {
  if (state.channels.has(id)) return state
  const channel: ChannelFlowState = {
    id,
    creditOutstanding: 0,
    windowTarget: opts?.windowTarget ?? 256 * 1024,
    maxWindow: opts?.maxWindow ?? 2 * 1024 * 1024,
  }
  const channels = new Map(state.channels)
  channels.set(id, channel)
  return { ...state, channels }
}

export function deregisterChannel(
  state: FlowControllerState,
  id: number,
): FlowControllerState {
  if (!state.channels.has(id)) return state
  const channels = new Map(state.channels)
  channels.delete(id)
  return { ...state, channels }
}

export function applyDataReceipt(
  state: FlowControllerState,
  id: number,
  bytes: number,
): FlowControllerState {
  const channel = state.channels.get(id)
  if (!channel) return state
  const nextOutstanding = Math.max(
    0,
    channel.creditOutstanding - Math.max(0, bytes),
  )
  const nextChannel: ChannelFlowState = {
    ...channel,
    creditOutstanding: nextOutstanding,
  }
  const channels = new Map(state.channels)
  channels.set(id, nextChannel)
  return { ...state, channels }
}

export function planCreditGrant(
  state: FlowControllerState,
  id: number,
  opts?: { readonly now?: number },
): CreditDecision {
  const channel = state.channels.get(id)
  if (!channel) {
    return {
      state,
      grant: 0,
      policyEvents: [],
    }
  }
  if (state.pausedReasons.size > 0) {
    return {
      state,
      grant: 0,
      policyEvents: [],
    }
  }
  const need = channel.windowTarget - channel.creditOutstanding
  if (need <= 0) {
    return {
      state,
      grant: 0,
      policyEvents: [],
    }
  }
  const grant = Math.min(need, channel.maxWindow - channel.creditOutstanding)
  if (grant <= 0) {
    return {
      state,
      grant: 0,
      policyEvents: [],
    }
  }
  const nextChannel: ChannelFlowState = {
    ...channel,
    creditOutstanding: channel.creditOutstanding + grant,
  }
  const channels = new Map(state.channels)
  channels.set(id, nextChannel)
  const policyEvents: PolicyEvent[] = [
    {
      type: 'credit_grant',
      channelId: id,
      granted: grant,
      outstanding: nextChannel.creditOutstanding,
      windowTarget: nextChannel.windowTarget,
      timestamp: opts?.now ?? Date.now(),
    },
  ]
  return {
    state: { ...state, channels },
    grant,
    policyEvents,
  }
}

export function updateTransportBackpressure(
  state: FlowControllerState,
  transportBackpressured: boolean,
  opts?: { readonly now?: number },
): FlowUpdate {
  if (state.transportBackpressured === transportBackpressured) {
    return { state, policyEvents: [] }
  }
  const pausedReasons = togglePauseReason(
    state.pausedReasons,
    'transport_backpressure',
    transportBackpressured,
  )
  const policyEvents = emitPauseEvents(
    state.pausedReasons,
    pausedReasons,
    'transport_backpressure',
    opts?.now,
  )
  return {
    state: {
      ...state,
      transportBackpressured,
      pausedReasons,
    },
    policyEvents,
  }
}

export function updateVisibilityHidden(
  state: FlowControllerState,
  hidden: boolean,
  opts?: { readonly now?: number },
): FlowUpdate {
  if (state.visibilityHidden === hidden) {
    return { state, policyEvents: [] }
  }
  const pausedReasons = togglePauseReason(
    state.pausedReasons,
    'visibility_hidden',
    hidden,
  )
  const policyEvents = emitPauseEvents(
    state.pausedReasons,
    pausedReasons,
    'visibility_hidden',
    opts?.now,
  )
  return {
    state: {
      ...state,
      visibilityHidden: hidden,
      pausedReasons,
    },
    policyEvents,
  }
}

export function updateOffline(
  state: FlowControllerState,
  offline: boolean,
  opts?: { readonly now?: number },
): FlowUpdate {
  if (state.offline === offline) {
    return { state, policyEvents: [] }
  }
  const pausedReasons = togglePauseReason(
    state.pausedReasons,
    'offline',
    offline,
  )
  const policyEvents = emitPauseEvents(
    state.pausedReasons,
    pausedReasons,
    'offline',
    opts?.now,
  )
  return {
    state: {
      ...state,
      offline,
      pausedReasons,
    },
    policyEvents,
  }
}

function computePausedReasons(
  transportBackpressured: boolean,
  visibilityHidden: boolean,
  offline: boolean,
): ReadonlySet<FlowPauseReason> {
  const reasons = new Set<FlowPauseReason>()
  if (transportBackpressured) reasons.add('transport_backpressure')
  if (visibilityHidden) reasons.add('visibility_hidden')
  if (offline) reasons.add('offline')
  return reasons
}

function togglePauseReason(
  set: ReadonlySet<FlowPauseReason>,
  reason: FlowPauseReason,
  active: boolean,
): ReadonlySet<FlowPauseReason> {
  const next = new Set(set)
  if (active) {
    next.add(reason)
  } else {
    next.delete(reason)
  }
  return next
}

function emitPauseEvents(
  previous: ReadonlySet<FlowPauseReason>,
  next: ReadonlySet<FlowPauseReason>,
  changedReason: FlowPauseReason,
  timestamp = Date.now(),
): PolicyEvent[] {
  const wasPaused = previous.has(changedReason)
  const isPaused = next.has(changedReason)
  if (wasPaused === isPaused) {
    return []
  }
  if (isPaused) {
    return [
      {
        type: 'flow_pause',
        reason: changedReason,
        timestamp,
      },
    ]
  }
  const resumeReason: FlowResumeReason =
    changedReason === 'transport_backpressure'
      ? 'transport_recovered'
      : changedReason === 'visibility_hidden'
        ? 'visibility_visible'
        : changedReason === 'offline'
          ? 'online'
          : 'policy_clear'
  return [
    {
      type: 'flow_resume',
      reason: resumeReason,
      timestamp,
    },
  ]
}
