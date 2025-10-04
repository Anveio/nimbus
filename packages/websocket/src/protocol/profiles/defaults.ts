import type { Ctl, DataFrame } from '../messages'
import { isCtl, isDataFrame } from '../messages'
import { getProfile, registerProfile, type WireProfile } from '../profiles'

const DEFAULT_MAX_FRAME = 1 * 1024 * 1024 // 1 MiB including headers

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const manaV1Profile: WireProfile = {
  id: 'mana.v1',
  subprotocols: ['mana.ssh.v1'],
  encodeCtl(msg: Ctl): string {
    return JSON.stringify(msg)
  },
  decodeCtl(frame: ArrayBuffer | string): Ctl | null {
    try {
      const json =
        typeof frame === 'string'
          ? frame
          : textDecoder.decode(new Uint8Array(frame))
      const obj = JSON.parse(json)
      return isCtl(obj) ? obj : null
    } catch {
      return null
    }
  },
  encodeData(
    df: DataFrame,
    caps?: { readonly maxFrame?: number },
  ): ArrayBuffer[] {
    const maxFrameCandidate = caps?.maxFrame ?? DEFAULT_MAX_FRAME
    const maxFrame = Math.max(
      512,
      Math.min(maxFrameCandidate, DEFAULT_MAX_FRAME * 8),
    )
    const headerSize = 1 + 4
    const maxPayload = Math.max(1, maxFrame - headerSize)
    const frames: ArrayBuffer[] = []
    const payload = df.payload
    const streamByte = df.stream === 'stdout' ? 0x01 : 0x02
    for (let offset = 0; offset < payload.length; offset += maxPayload) {
      const chunkLength = Math.min(maxPayload, payload.length - offset)
      const buffer = new ArrayBuffer(headerSize + chunkLength)
      const view = new DataView(buffer)
      view.setUint8(0, streamByte)
      view.setUint32(1, df.id)
      new Uint8Array(buffer, headerSize).set(
        payload.subarray(offset, offset + chunkLength),
      )
      frames.push(buffer)
    }
    return frames
  },
  decodeData(frame: ArrayBuffer | string): DataFrame | null {
    if (typeof frame === 'string') return null
    if (frame.byteLength < 5) return null
    const view = new DataView(frame)
    const streamByte = view.getUint8(0)
    const stream =
      streamByte === 0x01 ? 'stdout' : streamByte === 0x02 ? 'stderr' : null
    if (!stream) return null
    const id = view.getUint32(1)
    const payload = new Uint8Array(frame, 5)
    const dataFrame: DataFrame = { stream, id, payload }
    return isDataFrame(dataFrame) ? dataFrame : null
  },
}

export const jsonBase64V1Profile: WireProfile = {
  id: 'json-base64.v1',
  subprotocols: ['mana.ssh.v1'],
  encodeCtl(msg: Ctl): string {
    return JSON.stringify(msg)
  },
  decodeCtl(frame: ArrayBuffer | string): Ctl | null {
    try {
      const json =
        typeof frame === 'string'
          ? frame
          : textDecoder.decode(new Uint8Array(frame))
      const obj = JSON.parse(json)
      return isCtl(obj) ? obj : null
    } catch {
      return null
    }
  },
  encodeData(df: DataFrame): string[] {
    const payloadB64 = toBase64(df.payload)
    const envelope = {
      kind: 'data',
      stream: df.stream,
      id: df.id,
      payload: payloadB64,
    } as const
    return [JSON.stringify(envelope)]
  },
  decodeData(frame: ArrayBuffer | string): DataFrame | null {
    try {
      const json =
        typeof frame === 'string'
          ? frame
          : textDecoder.decode(new Uint8Array(frame))
      const obj = JSON.parse(json)
      if (!isRecord(obj) || obj.kind !== 'data') return null
      if (obj.stream !== 'stdout' && obj.stream !== 'stderr') return null
      if (!Number.isInteger(obj.id)) return null
      if (typeof obj.payload !== 'string') return null
      const payload = fromBase64(obj.payload)
      const id = Number(obj.id)
      const stream = obj.stream
      const dataFrame: DataFrame = { stream, id, payload }
      return isDataFrame(dataFrame) ? dataFrame : null
    } catch {
      return null
    }
  },
}

export const lenPrefixedV1Profile: WireProfile = {
  id: 'lenpfx.v1',
  subprotocols: ['mana.ssh.v1'],
  encodeCtl(msg: Ctl): ArrayBuffer {
    const payload = textEncoder.encode(JSON.stringify(msg))
    return buildLenPfxFrame(0x10, 0, payload)
  },
  decodeCtl(frame: ArrayBuffer | string): Ctl | null {
    const buffer =
      typeof frame === 'string' ? textEncoder.encode(frame).buffer : frame
    const parsed = parseLenPfxFrame(buffer)
    if (!parsed || parsed.kind !== 0x10) return null
    try {
      const json = textDecoder.decode(parsed.payload)
      const obj = JSON.parse(json)
      return isCtl(obj) ? obj : null
    } catch {
      return null
    }
  },
  encodeData(
    df: DataFrame,
    caps?: { readonly maxFrame?: number },
  ): ArrayBuffer[] {
    const maxFrameCandidate = caps?.maxFrame ?? DEFAULT_MAX_FRAME
    const maxFrame = Math.max(
      512,
      Math.min(maxFrameCandidate, DEFAULT_MAX_FRAME * 8),
    )
    const overhead = 4 + 1 + 4
    const maxPayload = Math.max(1, maxFrame - overhead)
    const frames: ArrayBuffer[] = []
    const streamKind = df.stream === 'stdout' ? 0x01 : 0x02
    for (let offset = 0; offset < df.payload.length; offset += maxPayload) {
      const chunkLength = Math.min(maxPayload, df.payload.length - offset)
      const slice = df.payload.subarray(offset, offset + chunkLength)
      frames.push(buildLenPfxFrame(streamKind, df.id, slice))
    }
    return frames
  },
  decodeData(frame: ArrayBuffer | string): DataFrame | null {
    const buffer =
      typeof frame === 'string' ? textEncoder.encode(frame).buffer : frame
    const parsed = parseLenPfxFrame(buffer)
    if (!parsed) return null
    if (parsed.kind !== 0x01 && parsed.kind !== 0x02) return null
    const stream = parsed.kind === 0x01 ? 'stdout' : 'stderr'
    const dataFrame: DataFrame = {
      stream,
      id: parsed.id,
      payload: parsed.payload,
    }
    return isDataFrame(dataFrame) ? dataFrame : null
  },
}

export function ensureDefaultProfiles(): void {
  if (!getProfile(manaV1Profile.id)) registerProfile(manaV1Profile)
  if (!getProfile(jsonBase64V1Profile.id)) registerProfile(jsonBase64V1Profile)
  if (!getProfile(lenPrefixedV1Profile.id))
    registerProfile(lenPrefixedV1Profile)
}

function buildLenPfxFrame(
  kind: number,
  id: number,
  payload: Uint8Array,
): ArrayBuffer {
  const totalLength = 1 + 4 + payload.length
  const buffer = new ArrayBuffer(4 + totalLength)
  const view = new DataView(buffer)
  view.setUint32(0, totalLength)
  view.setUint8(4, kind)
  view.setUint32(5, id >>> 0)
  new Uint8Array(buffer, 9).set(payload)
  return buffer
}

function parseLenPfxFrame(frame: ArrayBuffer): {
  readonly kind: number
  readonly id: number
  readonly payload: Uint8Array
} | null {
  if (frame.byteLength < 9) return null
  const view = new DataView(frame)
  const declaredLength = view.getUint32(0)
  if (declaredLength + 4 !== frame.byteLength) return null
  const kind = view.getUint8(4)
  const id = view.getUint32(5)
  const payload = new Uint8Array(frame, 9)
  return { kind, id, payload }
}

function toBase64(data: Uint8Array): string {
  const bufferCtor = getBuffer()
  if (bufferCtor) {
    return bufferCtor.from(data).toString('base64')
  }
  let binary = ''
  for (const byte of data) {
    binary += String.fromCharCode(byte)
  }
  const base64 = base64Global.btoa?.(binary)
  if (base64) return base64
  throw new Error('Base64 encoding not supported in this environment')
}

function fromBase64(value: string): Uint8Array {
  const bufferCtor = getBuffer()
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(value, 'base64'))
  }
  const binary = base64Global.atob?.(value)
  if (!binary)
    throw new Error('Base64 decoding not supported in this environment')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type BufferLike = Uint8Array & { toString(encoding: string): string }

type BufferConstructorLike = {
  from(input: Uint8Array): BufferLike
  from(input: string, encoding: string): BufferLike
}

function getBuffer(): BufferConstructorLike | undefined {
  const globalBuffer = (globalThis as Record<string, unknown>).Buffer as
    | BufferConstructorLike
    | undefined
  return globalBuffer
}

interface Base64Global {
  btoa?(data: string): string
  atob?(data: string): string
}

const base64Global = globalThis as Base64Global
