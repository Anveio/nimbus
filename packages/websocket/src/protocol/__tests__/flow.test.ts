import { describe, expect, it } from 'vitest'
import {
  applyDataReceipt,
  createFlowController,
  planCreditGrant,
  registerChannel,
  updateOffline,
  updateTransportBackpressure,
  updateVisibilityHidden,
} from '../flow'

describe('flow controller', () => {
  it('grants credit up to window target when not paused', () => {
    let state = createFlowController()
    state = registerChannel(state, 1, { windowTarget: 1024, maxWindow: 2048 })

    const decision = planCreditGrant(state, 1, { now: 10 })
    expect(decision.grant).toBe(1024)
    expect(decision.policyEvents[0]).toMatchObject({
      type: 'credit_grant',
      channelId: 1,
      granted: 1024,
    })
  })

  it('does not grant credit while backpressured and emits pause/resume', () => {
    let state = createFlowController()
    state = registerChannel(state, 2)

    const paused = updateTransportBackpressure(state, true, { now: 20 })
    expect(paused.policyEvents).toHaveLength(1)
    expect(paused.policyEvents[0]).toMatchObject({
      type: 'flow_pause',
      reason: 'transport_backpressure',
    })

    const decision = planCreditGrant(paused.state, 2)
    expect(decision.grant).toBe(0)

    const resumed = updateTransportBackpressure(paused.state, false, {
      now: 30,
    })
    expect(resumed.policyEvents[0]).toMatchObject({ type: 'flow_resume' })
  })

  it('never lets outstanding credit drop below zero after data receipts', () => {
    let state = createFlowController()
    state = registerChannel(state, 7, { windowTarget: 4096 })
    const first = planCreditGrant(state, 7)
    expect(first.grant).toBe(4096)
    state = first.state

    state = applyDataReceipt(state, 7, 5000)
    const decision = planCreditGrant(state, 7)
    expect(
      decision.state.channels.get(7)?.creditOutstanding,
    ).toBeLessThanOrEqual(4096)
  })

  it('keeps invariants across pseudo-random event streams', () => {
    let state = createFlowController()
    state = registerChannel(state, 42)
    const rng = makeRng(123456789)
    const maxIterations = 1000
    let outstanding = 0
    const maxWindow = state.channels.get(42)?.maxWindow ?? 2 * 1024 * 1024

    for (let i = 0; i < maxIterations; i += 1) {
      const rand = rng()
      if (rand < 0.4) {
        const decision = planCreditGrant(state, 42)
        outstanding += decision.grant
        state = decision.state
      } else {
        const bytes = Math.floor(rng() * 2048)
        outstanding = Math.max(0, outstanding - bytes)
        state = applyDataReceipt(state, 42, bytes)
      }
      const snapshot = state.channels.get(42)
      if (!snapshot) throw new Error('channel missing')
      expect(snapshot.creditOutstanding).toBeGreaterThanOrEqual(0)
      expect(snapshot.creditOutstanding).toBeLessThanOrEqual(maxWindow)
    }
  })

  it('pauses on visibility hidden and offline reasons', () => {
    let state = createFlowController()
    state = registerChannel(state, 5)

    const hidden = updateVisibilityHidden(state, true)
    expect(hidden.policyEvents[0]).toMatchObject({
      type: 'flow_pause',
      reason: 'visibility_hidden',
    })
    const offline = updateOffline(hidden.state, true)
    expect(offline.policyEvents[0]).toMatchObject({
      type: 'flow_pause',
      reason: 'offline',
    })
  })
})

function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1103515245 * state + 12345) >>> 0
    return state / 0xffffffff
  }
}
