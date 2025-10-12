import { describe, expect, it } from 'vitest'
import {
  createConnectionStateMachine,
  createInitialConnectionState,
  reduceConnection,
} from '../state'

describe('connection state machine', () => {
  it('records handshake diagnostics with resume attempt', () => {
    const base = createInitialConnectionState()
    const afterConnect = reduceConnection(
      base,
      { type: 'connect_requested' },
      0,
    )
    expect(afterConnect.phase).toBe('connecting')

    const afterHello = reduceConnection(
      afterConnect,
      {
        type: 'hello_sent',
        resumeToken: 'secret-token',
        profileRequested: 'nimbus.v1',
        timestamp: 10,
      },
      10,
    )

    expect(afterHello.diagnostics).toHaveLength(2)
    expect(afterHello.diagnostics[0]).toMatchObject({
      type: 'handshake',
      attempt: 1,
      resumeTokenPresent: true,
      profileRequested: 'nimbus.v1',
    })
    expect(afterHello.diagnostics[1]).toMatchObject({
      type: 'resume_attempt',
      tokenHash: expect.any(String),
    })
  })

  it('transitions to reconnecting after heartbeat misses threshold', () => {
    const initial = createInitialConnectionState({ heartbeatThreshold: 2 })
    let state = reduceConnection(
      initial,
      { type: 'heartbeat_miss', timestamp: 50 },
      50,
    )
    expect(state.phase).toBe('idle')
    state = reduceConnection(
      state,
      { type: 'heartbeat_miss', timestamp: 60 },
      60,
    )
    expect(state.phase).toBe('reconnecting')
    expect(state.diagnostics.at(-1)).toMatchObject({
      type: 'heartbeat_timeout',
      misses: 2,
    })
  })

  it('emits ping diagnostic with RTT on heartbeat ack', () => {
    let state = createInitialConnectionState()
    state = reduceConnection(
      state,
      { type: 'heartbeat_sent', timestamp: 100 },
      100,
    )
    state = reduceConnection(
      state,
      { type: 'heartbeat_ack', timestamp: 120 },
      120,
    )
    expect(state.diagnostics.at(-1)).toMatchObject({ type: 'ping', rttMs: 20 })
    expect(state.heartbeatMisses).toBe(0)
  })

  it('tracks channel lifecycle', () => {
    const machine = createConnectionStateMachine()
    machine.dispatch({ type: 'channel_open', channelId: 7 })
    machine.dispatch({ type: 'channel_open_ok', channelId: 7, resumeKey: 'rk' })
    expect(machine.state.channels.get(7)).toMatchObject({
      status: 'ready',
      resumeKey: 'rk',
    })
    machine.dispatch({ type: 'channel_closed', channelId: 7 })
    expect(machine.state.channels.get(7)).toMatchObject({ status: 'closed' })
  })

  it('records close diagnostics with codes', () => {
    const base = createInitialConnectionState()
    const closed = reduceConnection(
      base,
      {
        type: 'connection_closed',
        wsCode: 1008,
        appCode: 4003,
        reason: 'AUTH_FAILED',
        timestamp: 200,
      },
      200,
    )
    expect(closed.phase).toBe('closed')
    expect(closed.diagnostics.at(-1)).toMatchObject({
      type: 'close',
      wsCode: 1008,
      appCode: 4003,
      reason: 'AUTH_FAILED',
    })
  })
})
