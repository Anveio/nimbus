import { describe, expect, it } from 'vitest'
import { isCtl, isDataFrame } from '../messages'

describe('messages', () => {
  it('recognises valid hello control message', () => {
    const ctl = {
      t: 'hello',
      proto: 1,
      auth: { scheme: 'bearer', token: 'abc' },
      caps: { profile: 'nimbus.v1' },
    }
    expect(isCtl(ctl)).toBe(true)
  })

  it('rejects invalid control message', () => {
    const ctl = {
      t: 'hello',
      proto: 2,
    }
    expect(isCtl(ctl)).toBe(false)
  })

  it('recognises data frames', () => {
    const frame = {
      stream: 'stdout',
      id: 3,
      payload: new Uint8Array([1, 2, 3]),
    }
    expect(isDataFrame(frame)).toBe(true)
  })

  it('rejects malformed data frames', () => {
    const frame = { stream: 'stdout', id: 3, payload: [1, 2, 3] }
    expect(isDataFrame(frame)).toBe(false)
  })
})
