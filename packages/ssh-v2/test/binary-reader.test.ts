import { describe, expect, it } from 'vitest'

import { BinaryReader } from '../src/internal/binary/binary-reader'
import { BinaryWriter } from '../src/internal/binary/binary-writer'

describe('BinaryReader/BinaryWriter', () => {
  it('round-trips integers and strings', () => {
    const writer = new BinaryWriter()
    writer.writeUint8(7)
    writer.writeUint32(0x01020304)
    writer.writeString('mana')

    const buffer = writer.toUint8Array()
    const reader = new BinaryReader(buffer)

    expect(reader.readUint8()).toBe(7)
    expect(reader.readUint32()).toBe(0x01020304)
    expect(reader.readString()).toBe('mana')
    expect(reader.remaining).toBe(0)
  })

  it('detects insufficient data', () => {
    const writer = new BinaryWriter()
    writer.writeUint32(5)
    writer.writeBytes(Uint8Array.of(0, 1, 2))
    const reader = new BinaryReader(writer.toUint8Array())

    expect(() => reader.readString()).toThrowError(/Insufficient data/)
  })

  it('supports cloning without consuming state', () => {
    const writer = new BinaryWriter()
    writer.writeString('mana')
    const buffer = writer.toUint8Array()

    const reader = new BinaryReader(buffer)
    const clone = reader.clone()

    expect(clone.readString()).toBe('mana')
    expect(reader.readString()).toBe('mana')
  })

  it('writes and reads UTF-8 payloads losslessly', () => {
    const writer = new BinaryWriter()
    writer.writeString('Δssh')
    const reader = new BinaryReader(writer.toUint8Array())
    expect(reader.readString()).toBe('Δssh')
  })

  it('exposes raw bytes without advancing via peek', () => {
    const writer = new BinaryWriter()
    writer.writeBytes(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
    const reader = new BinaryReader(writer.toUint8Array())

    const peeked = reader.peek(2)
    expect(Array.from(peeked)).toEqual([0xde, 0xad])
    expect(reader.readBytes(2)).toEqual(peeked)
  })
})
