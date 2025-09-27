import type { SosPmApcKind } from '../types'

export type C1Action =
  | { readonly type: 'enterCsi' }
  | { readonly type: 'enterOsc' }
  | { readonly type: 'enterDcs' }
  | { readonly type: 'enterSosPmApc'; readonly kind: SosPmApcKind }
  | { readonly type: 'dispatchEscape'; readonly final: number }
  | { readonly type: 'execute' }
  | { readonly type: 'ignore' }

export const BYTE_TO_C1_ACTION: ReadonlyMap<number, C1Action> = new Map([
  [0x90, { type: 'enterDcs' }],
  [0x84, { type: 'dispatchEscape', final: 0x44 }], // IND => ESC D
  [0x85, { type: 'dispatchEscape', final: 0x45 }], // NEL => ESC E
  [0x86, { type: 'dispatchEscape', final: 0x46 }], // SSA => ESC F
  [0x87, { type: 'dispatchEscape', final: 0x47 }], // ESA => ESC G
  [0x88, { type: 'dispatchEscape', final: 0x48 }], // HTS => ESC H
  [0x89, { type: 'dispatchEscape', final: 0x49 }], // HTJ => ESC I
  [0x8a, { type: 'dispatchEscape', final: 0x4a }], // VTS => ESC J
  [0x8b, { type: 'dispatchEscape', final: 0x4b }], // PLD => ESC K
  [0x8c, { type: 'dispatchEscape', final: 0x4c }], // PLU => ESC L
  [0x8d, { type: 'dispatchEscape', final: 0x4d }], // RI => ESC M
  [0x8e, { type: 'dispatchEscape', final: 0x4e }], // SS2 => ESC N
  [0x8f, { type: 'dispatchEscape', final: 0x4f }], // SS3 => ESC O
  [0x91, { type: 'dispatchEscape', final: 0x51 }], // PU1 => ESC Q
  [0x92, { type: 'dispatchEscape', final: 0x52 }], // PU2 => ESC R
  [0x93, { type: 'dispatchEscape', final: 0x53 }], // STS => ESC S
  [0x94, { type: 'dispatchEscape', final: 0x54 }], // CCH => ESC T
  [0x95, { type: 'dispatchEscape', final: 0x55 }], // MW => ESC U
  [0x96, { type: 'dispatchEscape', final: 0x56 }], // SPA => ESC V
  [0x97, { type: 'dispatchEscape', final: 0x57 }], // EPA => ESC W
  [0x98, { type: 'enterSosPmApc', kind: 'SOS' }],
  [0x9b, { type: 'enterCsi' }],
  [0x9c, { type: 'ignore' }],
  [0x9d, { type: 'enterOsc' }],
  [0x9e, { type: 'enterSosPmApc', kind: 'PM' }],
  [0x9f, { type: 'enterSosPmApc', kind: 'APC' }],
])
