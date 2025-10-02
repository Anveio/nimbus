import type { SosPmApcKind } from '../types'
import { ASCII_CODES, C1_CONTROL_BYTES } from './byte-constants'

export type C1Action =
  | { readonly type: 'enterCsi' }
  | { readonly type: 'enterOsc' }
  | { readonly type: 'enterDcs' }
  | { readonly type: 'enterSosPmApc'; readonly kind: SosPmApcKind }
  | { readonly type: 'dispatchEscape'; readonly final: number }
  | { readonly type: 'execute' }
  | { readonly type: 'ignore' }

export const BYTE_TO_C1_ACTION: ReadonlyMap<number, C1Action> = new Map([
  [C1_CONTROL_BYTES.DCS, { type: 'enterDcs' }],
  [C1_CONTROL_BYTES.IND, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_D }],
  [C1_CONTROL_BYTES.NEL, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_E }],
  [C1_CONTROL_BYTES.SSA, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_F }],
  [C1_CONTROL_BYTES.ESA, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_G }],
  [C1_CONTROL_BYTES.HTS, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_H }],
  [C1_CONTROL_BYTES.HTJ, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_I }],
  [C1_CONTROL_BYTES.VTS, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_J }],
  [C1_CONTROL_BYTES.PLD, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_K }],
  [C1_CONTROL_BYTES.PLU, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_L }],
  [C1_CONTROL_BYTES.RI, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_M }],
  [C1_CONTROL_BYTES.SS2, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_N }],
  [C1_CONTROL_BYTES.SS3, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_O }],
  [C1_CONTROL_BYTES.PU1, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_Q }],
  [C1_CONTROL_BYTES.PU2, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_R }],
  [C1_CONTROL_BYTES.STS, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_S }],
  [C1_CONTROL_BYTES.CCH, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_T }],
  [C1_CONTROL_BYTES.MW, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_U }],
  [C1_CONTROL_BYTES.SPA, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_V }],
  [C1_CONTROL_BYTES.EPA, { type: 'dispatchEscape', final: ASCII_CODES.UPPERCASE_W }],
  [C1_CONTROL_BYTES.SOS, { type: 'enterSosPmApc', kind: 'SOS' }],
  [C1_CONTROL_BYTES.CSI, { type: 'enterCsi' }],
  [C1_CONTROL_BYTES.STRING_TERMINATOR, { type: 'ignore' }],
  [C1_CONTROL_BYTES.OSC, { type: 'enterOsc' }],
  [C1_CONTROL_BYTES.PM, { type: 'enterSosPmApc', kind: 'PM' }],
  [C1_CONTROL_BYTES.APC, { type: 'enterSosPmApc', kind: 'APC' }],
])
