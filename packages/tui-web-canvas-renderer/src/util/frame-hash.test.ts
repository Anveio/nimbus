import { describe, expect, it } from 'vitest'
import { hashFrameBytes } from './frame-hash'

describe('hashFrameBytes', () => {
  it('produces deterministic hashes for identical inputs', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5])
    const first = hashFrameBytes(data, 2, 3)
    const second = hashFrameBytes(data, 2, 3)

    expect(first).toBe(second)
    expect(first).toMatch(/^fnv1a32:2x3:[0-9a-f]{8}$/)
  })

  it('hash changes when dimensions differ', () => {
    const payload = new Uint8Array([10, 20, 30])

    const hashA = hashFrameBytes(payload, 4, 4)
    const hashB = hashFrameBytes(payload, 5, 4)

    expect(hashA).not.toBe(hashB)
  })

  it('hash changes when bytes differ', () => {
    const payloadA = new Uint8Array([10, 20, 30])
    const payloadB = new Uint8Array([10, 20, 31])

    const hashA = hashFrameBytes(payloadA, 4, 4)
    const hashB = hashFrameBytes(payloadB, 4, 4)

    expect(hashA).not.toBe(hashB)
  })
})
