// Core types that describe parser state and events. No implementations yet.

/**
 * Parser states as described by the VT500 state machine.
 */
export enum ParserState {
  Ground = "ground",
  Escape = "escape",
  EscapeIntermediate = "escape_intermediate",
  CsiEntry = "csi_entry",
  CsiParam = "csi_param",
  CsiIntermediate = "csi_intermediate",
  CsiIgnore = "csi_ignore",
  OscString = "osc_string",
  DcsEntry = "dcs_entry",
  DcsParam = "dcs_param",
  DcsIntermediate = "dcs_intermediate",
  DcsIgnore = "dcs_ignore",
  DcsPassthrough = "dcs_passthrough",
  SosPmApcString = "sos_pm_apc_string",
}

/**
 * Bit flags that describe the classes a byte belongs to. A single byte may
 * belong to multiple classes depending on the state table edge definitions.
 */
export enum ByteFlag {
  None = 0,
  C0Control = 1 << 0,
  C1Control = 1 << 1,
  Printable = 1 << 2,
  Escape = 1 << 3,
  Parameter = 1 << 4,
  Intermediate = 1 << 5,
  Final = 1 << 6,
  Delete = 1 << 7,
  StringTerminator = 1 << 8,
}

/**
 * Event types emitted by the parser.
 */
export enum ParserEventType {
  Print = "print",
  Execute = "execute",
  EscDispatch = "esc_dispatch",
  CsiDispatch = "csi_dispatch",
  OscDispatch = "osc_dispatch",
  DcsHook = "dcs_hook",
  DcsPut = "dcs_put",
  DcsUnhook = "dcs_unhook",
  Ignore = "ignore",
}

/**
 * Payload schema for parser events.
 */
export type ParserEvent =
  | { readonly type: ParserEventType.Print; readonly data: Uint8Array }
  | { readonly type: ParserEventType.Execute; readonly codePoint: number }
  | {
      readonly type: ParserEventType.EscDispatch;
      readonly finalByte: number;
      readonly intermediates: ReadonlyArray<number>;
    }
  | {
      readonly type: ParserEventType.CsiDispatch;
      readonly finalByte: number;
      readonly params: ReadonlyArray<number>;
      readonly intermediates: ReadonlyArray<number>;
      readonly prefix: number | null;
    }
  | {
      readonly type: ParserEventType.OscDispatch;
      readonly data: Uint8Array;
    }
  | {
      readonly type: ParserEventType.DcsHook;
      readonly finalByte: number;
      readonly params: ReadonlyArray<number>;
      readonly intermediates: ReadonlyArray<number>;
    }
  | { readonly type: ParserEventType.DcsPut; readonly data: Uint8Array }
  | { readonly type: ParserEventType.DcsUnhook }
  | { readonly type: ParserEventType.Ignore };

/**
 * API for receiving parser events.
 */
export interface ParserEventSink {
  onEvent(event: ParserEvent): void;
}

/**
 * Public interface for parser instances.
 */
export interface Parser {
  readonly state: ParserState;
  write(input: Uint8Array | string, sink: ParserEventSink): void;
  reset(): void;
}
