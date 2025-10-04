import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { classifyByte } from './classifier'
import { ByteFlag } from '../types'

describe('classifyByte', () => {
  it('categorises ESC as escape', () => {
    const flags = classifyByte(0x1b)
    expect(flags & ByteFlag.Escape).not.toBe(0)
    expect(flags & ByteFlag.C0Control).not.toBe(0)
  })

  it('categorises printable ASCII', () => {
    const flags = classifyByte(0x41)
    expect(flags & ByteFlag.Printable).not.toBe(0)
  })

  it('categorises C0 controls', () => {
    expect(classifyByte(0x07) & ByteFlag.StringTerminator).not.toBe(0)
    expect(classifyByte(0x1f) & ByteFlag.C0Control).not.toBe(0)
  })

  it('prioritises delete over printable', () => {
    expect(classifyByte(0x7f) & ByteFlag.Delete).not.toBe(0)
  })

  it('prioritises final bytes after parameters', () => {
    expect(classifyByte(0x41) & ByteFlag.Printable).not.toBe(0)
    expect(classifyByte(0x40) & ByteFlag.Final).not.toBe(0)
  })
})

const computeExpectedFlags = (value: number): number => {
  let flags = ByteFlag.None

  if (value >= 0x00 && value <= 0x1f) flags |= ByteFlag.C0Control
  if (value === 0x7f) flags |= ByteFlag.Delete
  if (value >= 0x80 && value <= 0x9f) flags |= ByteFlag.C1Control
  if (value === 0x1b) flags |= ByteFlag.Escape
  if (value >= 0x20 && value <= 0x2f) flags |= ByteFlag.Intermediate
  if (value >= 0x30 && value <= 0x3f) flags |= ByteFlag.Parameter
  if (value >= 0x40 && value <= 0x7e) flags |= ByteFlag.Final
  if (value >= 0x20 && value <= 0x7e) flags |= ByteFlag.Printable
  if (value === 0x07 || value === 0x9c) flags |= ByteFlag.StringTerminator

  return flags === ByteFlag.None ? ByteFlag.Printable : flags
}

const ALL_FLAGS_MASK =
  ByteFlag.C0Control |
  ByteFlag.C1Control |
  ByteFlag.Printable |
  ByteFlag.Escape |
  ByteFlag.Parameter |
  ByteFlag.Intermediate |
  ByteFlag.Final |
  ByteFlag.Delete |
  ByteFlag.StringTerminator

describe('classifyByte fuzz properties', () => {
  it('matches the VT500-derived specification for the entire byte range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0x00, max: 0xff }), (value) => {
        const actual = classifyByte(value)
        const expected = computeExpectedFlags(value)
        expect(actual).toBe(expected)
      }),
      { numRuns: 2048 },
    )
  })

  it('never sets unknown flag bits', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0x00, max: 0xff }), (value) => {
        const actual = classifyByte(value)
        expect(actual & ~ALL_FLAGS_MASK).toBe(0)
      }),
      { numRuns: 2048 },
    )
  })
})
