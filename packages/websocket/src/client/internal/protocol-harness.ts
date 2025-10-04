import type {
  Ctl,
  DataFrame,
  DiagnosticEvent,
  PolicyEvent,
  WireProfile,
} from '../../protocol'
import {
  applyDataReceipt,
  createFlowController,
  type FlowControllerState,
  planCreditGrant,
  updateOffline,
  updateTransportBackpressure,
  updateVisibilityHidden,
} from '../../protocol/flow'
import {
  type ConnectionEvent,
  type ConnectionStateMachine,
  createConnectionStateMachine,
  createInitialConnectionState,
} from '../../protocol/state'
import type { ConnectionState } from '../types'
import type { EventBus } from './event-bus'
import type { RuntimeWebSocket } from './socket'

export type HarnessEvents = {
  readonly statechange: readonly [ConnectionState]
  readonly diagnostic: readonly [DiagnosticEvent]
  readonly policy: readonly [PolicyEvent]
}

export interface HarnessChannel {
  readonly id: number
  readonly drainData: (payload: Uint8Array, stream: 'stdout' | 'stderr') => void
}

export interface ProtocolHarness {
  readonly socket: RuntimeWebSocket
  readonly wireProfile: WireProfile
  readonly flow: FlowControllerState
  readonly stateMachine: ConnectionStateMachine
  readonly events: EventBus<HarnessEvents>
  sendControl(msg: Ctl): void
  sendData(df: DataFrame): void
  update(event: ConnectionEvent): void
  mutateFlow(flow: FlowControllerState): void
  handleTransportBackpressure(backpressured: boolean): void
  handleVisibilityHidden(hidden: boolean): void
  handleOffline(offline: boolean): void
}

export function createProtocolHarness(
  socket: RuntimeWebSocket,
  wireProfile: WireProfile,
  events: EventBus<HarnessEvents>,
  flowOverrides?: Partial<FlowControllerState>,
  initialStateOverrides?: Parameters<typeof createInitialConnectionState>[0],
): ProtocolHarness {
  const stateMachine = createConnectionStateMachine(
    createInitialConnectionState(initialStateOverrides),
  )
  let flow = createFlowController({
    highWaterMark: flowOverrides?.highWaterMark,
    lowWaterMark: flowOverrides?.lowWaterMark,
    transportBackpressured: flowOverrides?.transportBackpressured,
    visibilityHidden: flowOverrides?.visibilityHidden,
    offline: flowOverrides?.offline,
  })

  const publishState = () => {
    const phases: Record<string, ConnectionState> = {
      idle: 'connecting',
      connecting: 'connecting',
      authenticating: 'authenticating',
      ready: 'ready',
      reconnecting: 'reconnecting',
      closed: 'closed',
    }
    const mapped = phases[stateMachine.state.phase] ?? 'connecting'
    events.emit('statechange', mapped)
  }

  return {
    socket,
    wireProfile,
    get flow() {
      return flow
    },
    get stateMachine() {
      return stateMachine
    },
    events,
    sendControl(msg: Ctl) {
      const frame = wireProfile.encodeCtl(msg)
      socket.send(frame)
    },
    sendData(df: DataFrame) {
      const negotiatedMaxFrame =
        typeof stateMachine.state.serverCaps?.maxFrame === 'number'
          ? stateMachine.state.serverCaps.maxFrame
          : undefined
      const frames = wireProfile.encodeData(
        df,
        negotiatedMaxFrame !== undefined
          ? { maxFrame: negotiatedMaxFrame }
          : undefined,
      )
      for (const frame of frames) {
        socket.send(frame)
      }
    },
    update(event: ConnectionEvent) {
      stateMachine.dispatch(event)
      publishState()
    },
    mutateFlow(next) {
      flow = next
    },
    handleTransportBackpressure(backpressured) {
      const update = updateTransportBackpressure(flow, backpressured)
      flow = update.state
      update.policyEvents.forEach((evt) => {
        events.emit('policy', evt)
      })
    },
    handleVisibilityHidden(hidden) {
      const update = updateVisibilityHidden(flow, hidden)
      flow = update.state
      update.policyEvents.forEach((evt) => {
        events.emit('policy', evt)
      })
    },
    handleOffline(offline) {
      const update = updateOffline(flow, offline)
      flow = update.state
      update.policyEvents.forEach((evt) => {
        events.emit('policy', evt)
      })
    },
  }
}

export function applyInboundData(
  harness: ProtocolHarness,
  channelId: number,
  bytes: number,
): void {
  const next = applyDataReceipt(harness.flow, channelId, bytes)
  harness.mutateFlow(next)
}

export function maybeGrantCredit(
  harness: ProtocolHarness,
  channelId: number,
  now = Date.now(),
): void {
  const decision = planCreditGrant(harness.flow, channelId, { now })
  harness.mutateFlow(decision.state)
  decision.policyEvents.forEach((evt) => {
    harness.events.emit('policy', evt)
  })
  if (decision.grant > 0) {
    harness.sendControl({ t: 'flow', id: channelId, credit: decision.grant })
  }
}
