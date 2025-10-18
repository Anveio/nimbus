import { describe, expect, test } from 'vitest'

import { TokenBucket } from '../src/api'

describe('TokenBucket', () => {
  test('rejects invalid configuration', () => {
    expect(
      () =>
        new TokenBucket({
          capacity: 0,
          refillPerSecond: 1,
        }),
    ).toThrow()
    expect(
      () =>
        new TokenBucket({
          capacity: 100,
          refillPerSecond: 0,
        }),
    ).toThrow()
  })

  test('allows immediate consumption within capacity', () => {
    const bucket = new TokenBucket({
      capacity: 1000,
      refillPerSecond: 1000,
    })
    expect(bucket.take(400, 0)).toBe(0)
    const snapshot = bucket.inspect(0)
    expect(snapshot.available).toBe(600)
    expect(snapshot.debt).toBe(0)
  })

  test('computes wait time for overdraw and tracks debt', () => {
    const bucket = new TokenBucket({
      capacity: 1000,
      refillPerSecond: 1000,
    })
    expect(bucket.take(1000, 0)).toBe(0)
    expect(bucket.take(1000, 0)).toBe(1000)
    const halfway = bucket.inspect(500)
    expect(halfway.available).toBe(0)
    expect(halfway.debt).toBeCloseTo(500, 3)
    const releaseDelay = bucket.take(500, 2000)
    expect(releaseDelay).toBe(0)
    const cleared = bucket.inspect(2000)
    expect(cleared.debt).toBe(0)
    expect(cleared.available).toBe(500)
  })

  test('reset replaces token balance', () => {
    const bucket = new TokenBucket({
      capacity: 200,
      refillPerSecond: 100,
      initialTokens: 10,
    })
    expect(bucket.take(20, 0)).toBe(100)
    bucket.reset(50, 0)
    const snapshot = bucket.inspect(0)
    expect(snapshot.available).toBe(50)
  })

  test('rejects invalid amounts', () => {
    const bucket = new TokenBucket({
      capacity: 100,
      refillPerSecond: 100,
    })
    expect(() => bucket.take(Number.NaN, 0)).toThrow()
  })
})
