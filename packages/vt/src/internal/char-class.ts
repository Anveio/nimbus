import { ByteFlag } from '../types'
import {
  ASCII_CODES,
  ASCII_RANGE,
  BYTE_LIMITS,
  C0_CONTROL_BYTES,
  C1_CONTROL_BYTES,
  C1_CONTROL_RANGE,
} from './byte-constants'

export interface ByteRange {
  readonly start: number
  readonly end: number
  readonly flag: ByteFlag
}

export const BYTE_RANGES: ReadonlyArray<ByteRange> = [
  {
    start: C0_CONTROL_BYTES.NUL,
    end: ASCII_RANGE.C0_MAX,
    flag: ByteFlag.C0Control,
  },
  { start: ASCII_CODES.DELETE, end: ASCII_CODES.DELETE, flag: ByteFlag.Delete },
  {
    start: C1_CONTROL_RANGE.START,
    end: C1_CONTROL_RANGE.END,
    flag: ByteFlag.C1Control,
  },
  {
    start: C0_CONTROL_BYTES.ESCAPE,
    end: C0_CONTROL_BYTES.ESCAPE,
    flag: ByteFlag.Escape,
  },
  {
    start: BYTE_LIMITS.INTERMEDIATE_START,
    end: BYTE_LIMITS.INTERMEDIATE_END,
    flag: ByteFlag.Intermediate,
  },
  {
    start: BYTE_LIMITS.PARAM_START,
    end: BYTE_LIMITS.PARAM_END,
    flag: ByteFlag.Parameter,
  },
  {
    start: BYTE_LIMITS.FINAL_START,
    end: BYTE_LIMITS.FINAL_END,
    flag: ByteFlag.Final,
  },
  {
    start: ASCII_RANGE.PRINTABLE_MIN,
    end: ASCII_RANGE.PRINTABLE_MAX,
    flag: ByteFlag.Printable,
  },
  {
    start: C1_CONTROL_BYTES.STRING_TERMINATOR,
    end: C1_CONTROL_BYTES.STRING_TERMINATOR,
    flag: ByteFlag.StringTerminator,
  },
  {
    start: C0_CONTROL_BYTES.BEL,
    end: C0_CONTROL_BYTES.BEL,
    flag: ByteFlag.StringTerminator,
  },
]
