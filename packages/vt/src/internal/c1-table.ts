import {
  ParserEventSink,
  ParserEventType,
  ParserState,
  type SosPmApcKind,
} from '../types'

export type C1Action =
  | { readonly type: 'enterCsi' }
  | { readonly type: 'enterOsc' }
  | { readonly type: 'enterDcs' }
  | { readonly type: 'enterSosPmApc'; readonly kind: SosPmApcKind }
  | { readonly type: 'dispatchEscape'; readonly final: number }
  | { readonly type: 'execute' }
  | { readonly type: 'ignore' }

const SPEC_MAP: ReadonlyMap<number, C1Action> = new Map([
  [0x90, { type: 'enterDcs' }],
  [0x84, { type: 'dispatchEscape', final: 0x44 }], // IND => ESC D
  [0x85, { type: 'dispatchEscape', final: 0x45 }], // NEL => ESC E
  [0x88, { type: 'dispatchEscape', final: 0x48 }], // HTS => ESC H
  [0x8d, { type: 'dispatchEscape', final: 0x4d }], // RI => ESC M
  [0x8e, { type: 'dispatchEscape', final: 0x4e }], // SS2 => ESC N
  [0x8f, { type: 'dispatchEscape', final: 0x4f }], // SS3 => ESC O
  [0x98, { type: 'enterSosPmApc', kind: 'SOS' }],
  [0x9b, { type: 'enterCsi' }],
  [0x9c, { type: 'ignore' }],
  [0x9d, { type: 'enterOsc' }],
  [0x9e, { type: 'enterSosPmApc', kind: 'PM' }],
  [0x9f, { type: 'enterSosPmApc', kind: 'APC' }],
])

export const getSpecC1Action = (byte: number): C1Action | undefined =>
  SPEC_MAP.get(byte)
