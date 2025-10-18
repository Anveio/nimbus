import { describe, expect, test } from 'vitest'

import {
  encodeTerminalModes,
  TERMINAL_MODE_END,
  TERMINAL_MODE_ISPEED,
  TERMINAL_MODE_OSPEED,
} from '../src/internal/terminal-modes'

describe('terminal modes encoder', () => {
  test('encodes speed opcodes with sentinel', () => {
    const encoded = encodeTerminalModes([
      { opcode: TERMINAL_MODE_ISPEED, argument: 115200 },
      { opcode: TERMINAL_MODE_OSPEED, argument: 115200 },
    ])
    expect(encoded).toEqual(
      Uint8Array.of(
        TERMINAL_MODE_ISPEED,
        0,
        1,
        194,
        0,
        TERMINAL_MODE_OSPEED,
        0,
        1,
        194,
        0,
        TERMINAL_MODE_END,
      ),
    )
  })

  test('skips extra END opcode entries', () => {
    const encoded = encodeTerminalModes([
      { opcode: TERMINAL_MODE_END, argument: 0 },
    ])
    expect(encoded).toEqual(Uint8Array.of(TERMINAL_MODE_END))
  })

  test('rejects arguments outside uint32', () => {
    expect(() =>
      encodeTerminalModes([{ opcode: TERMINAL_MODE_ISPEED, argument: -1 }]),
    ).toThrow(RangeError)
    expect(() =>
      encodeTerminalModes([
        { opcode: TERMINAL_MODE_ISPEED, argument: Number.POSITIVE_INFINITY },
      ]),
    ).toThrow(RangeError)
    expect(() =>
      encodeTerminalModes([
        { opcode: TERMINAL_MODE_ISPEED, argument: 0x1_0000_0000 },
      ]),
    ).toThrow(RangeError)
  })

  test('rejects opcode outside byte range', () => {
    expect(() =>
      encodeTerminalModes([{ opcode: -1, argument: 0 }]),
    ).toThrow(RangeError)
    expect(() =>
      encodeTerminalModes([{ opcode: 256, argument: 0 }]),
    ).toThrow(RangeError)
  })
})
