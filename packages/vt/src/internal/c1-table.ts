import { ParserEventSink, ParserEventType, SosPmApcKind } from "../types";
import { ParserState } from "../types";

export type C1Action =
  | { readonly type: "enterCsi" }
  | { readonly type: "enterOsc" }
  | { readonly type: "enterDcs" }
  | { readonly type: "enterSosPmApc"; readonly kind: SosPmApcKind }
  | { readonly type: "execute" }
  | { readonly type: "ignore" };

const SPEC_MAP: ReadonlyMap<number, C1Action> = new Map(
  [
    [0x90, { type: "enterDcs" }],
    [0x98, { type: "enterSosPmApc", kind: "SOS" }],
    [0x9b, { type: "enterCsi" }],
    [0x9c, { type: "ignore" }],
    [0x9d, { type: "enterOsc" }],
    [0x9e, { type: "enterSosPmApc", kind: "PM" }],
    [0x9f, { type: "enterSosPmApc", kind: "APC" }],
  ],
);

export const getSpecC1Action = (byte: number): C1Action | undefined =>
  SPEC_MAP.get(byte);
