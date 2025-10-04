import { describe, expect, it } from 'vitest'
import type { Ctl } from '../messages'
import { clearProfilesForTest, getProfile } from '../profiles'
import {
  ensureDefaultProfiles,
  jsonBase64V1Profile,
  lenPrefixedV1Profile,
  manaV1Profile,
} from '../profiles/defaults'

const sampleHello: Ctl = { t: 'hello', proto: 1, caps: { profile: 'mana.v1' } }

function makePayload(length: number): Uint8Array {
  const buf = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) {
    buf[i] = i % 251
  }
  return buf
}

describe('wire profiles', () => {
  it('registers default profiles idempotently', () => {
    clearProfilesForTest()
    ensureDefaultProfiles()
    ensureDefaultProfiles()
    expect(getProfile('mana.v1')).toBeDefined()
    expect(getProfile('json-base64.v1')).toBeDefined()
    expect(getProfile('lenpfx.v1')).toBeDefined()
  })

  it('round-trips control frames for mana.v1', () => {
    const encoded = manaV1Profile.encodeCtl(sampleHello)
    expect(typeof encoded).toBe('string')
    const decoded = manaV1Profile.decodeCtl(encoded)
    expect(decoded).toEqual(sampleHello)
  })

  it('splits mana.v1 data frames at caps.maxFrame', () => {
    const payload = makePayload(2_000_000)
    const frames = manaV1Profile.encodeData(
      { stream: 'stdout', id: 5, payload },
      { maxFrame: 64_000 },
    )
    expect(frames.length).toBeGreaterThan(1)
    const reconstructed = frames
      .map((frame) => manaV1Profile.decodeData(frame))
      .filter(
        (f): f is NonNullable<ReturnType<typeof manaV1Profile.decodeData>> =>
          Boolean(f),
      )
    const combined = concatenate(reconstructed.map((f) => f.payload))
    expect(combined).toHaveLength(payload.length)
  })

  it('round-trips json-base64 data frames', () => {
    const payload = makePayload(256)
    const encoded = jsonBase64V1Profile.encodeData({
      stream: 'stderr',
      id: 99,
      payload,
    })
    expect(encoded).toHaveLength(1)
    const firstFrame = encoded[0]
    if (!firstFrame) throw new Error('expected encoded frame')
    const decoded = jsonBase64V1Profile.decodeData(firstFrame)
    expect(decoded).not.toBeNull()
    expect(decoded?.stream).toBe('stderr')
    expect(decoded?.id).toBe(99)
    expect(decoded && compare(payload, decoded.payload)).toBe(true)
  })

  it('round-trips lenpfx.v1 control and data frames', () => {
    const ctlEncoded = lenPrefixedV1Profile.encodeCtl(sampleHello)
    const ctlDecoded = lenPrefixedV1Profile.decodeCtl(ctlEncoded)
    expect(ctlDecoded).toEqual(sampleHello)

    const payload = makePayload(512)
    const dataFrames = lenPrefixedV1Profile.encodeData(
      { stream: 'stdout', id: 15, payload },
      { maxFrame: 1024 },
    )
    expect(dataFrames.length).toBeGreaterThan(0)
    const decoded = dataFrames.map((frame) =>
      lenPrefixedV1Profile.decodeData(frame),
    )
    decoded.forEach((df) => {
      expect(df?.stream).toBe('stdout')
    })
    const combined = concatenate(
      decoded
        .filter((df): df is NonNullable<typeof df> => Boolean(df))
        .map((df) => df.payload),
    )
    expect(compare(payload, combined)).toBe(true)
  })
})

function concatenate(buffers: Uint8Array[]): Uint8Array {
  const total = buffers.reduce((sum, buf) => sum + buf.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    out.set(buf, offset)
    offset += buf.length
  }
  return out
}

function compare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}
