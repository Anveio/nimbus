// Core types that describe parser state and events. No implementations yet.
/**
 * Parser states as described by the VT500 state machine.
 */
export enum ParserState {
  Ground = 'ground',
  Escape = 'escape',
  EscapeIntermediate = 'escape_intermediate',
  CsiEntry = 'csi_entry',
  CsiParam = 'csi_param',
  CsiIntermediate = 'csi_intermediate',
  CsiIgnore = 'csi_ignore',
  OscString = 'osc_string',
  DcsEntry = 'dcs_entry',
  DcsParam = 'dcs_param',
  DcsIntermediate = 'dcs_intermediate',
  DcsIgnore = 'dcs_ignore',
  DcsPassthrough = 'dcs_passthrough',
  SosPmApcString = 'sos_pm_apc_string',
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
  Print = 'print',
  Execute = 'execute',
  EscDispatch = 'esc_dispatch',
  CsiDispatch = 'csi_dispatch',
  OscDispatch = 'osc_dispatch',
  DcsHook = 'dcs_hook',
  DcsPut = 'dcs_put',
  DcsUnhook = 'dcs_unhook',
  SosPmApcDispatch = 'sos_pm_apc_dispatch',
  Ignore = 'ignore',
}

/**
 * Payload schema for parser events.
 */
export type ParserEvent =
  | { readonly type: ParserEventType.Print; readonly data: Uint8Array }
  | { readonly type: ParserEventType.Execute; readonly codePoint: number }
  | {
      readonly type: ParserEventType.EscDispatch
      readonly finalByte: number
      readonly intermediates: ReadonlyArray<number>
    }
  | {
      readonly type: ParserEventType.CsiDispatch
      readonly finalByte: number
      readonly params: ReadonlyArray<number>
      readonly paramSeparators: ReadonlyArray<'colon' | 'semicolon'>
      readonly intermediates: ReadonlyArray<number>
      readonly prefix: number | null
    }
  | {
      readonly type: ParserEventType.OscDispatch
      readonly data: Uint8Array
    }
  | {
      readonly type: ParserEventType.DcsHook
      readonly finalByte: number
      readonly params: ReadonlyArray<number>
      readonly intermediates: ReadonlyArray<number>
    }
  | { readonly type: ParserEventType.DcsPut; readonly data: Uint8Array }
  | { readonly type: ParserEventType.DcsUnhook }
  | {
      readonly type: ParserEventType.SosPmApcDispatch
      readonly kind: SosPmApcKind
      readonly data: Uint8Array
    }
  | { readonly type: ParserEventType.Ignore }

/**
 * API for receiving parser events.
 */
export interface ParserEventSink {
  onEvent(event: ParserEvent): void
}

export type C1HandlingMode = 'spec' | 'escaped' | 'execute' | 'ignore'

export type ParserSpec =
  | 'vt100'
  | 'vt220'
  | 'vt320'
  | 'vt420'
  | 'vt520'
  | 'vt525'

export type TerminalEmulator = 'xterm' | 'kitty'

export interface ParserOptions {
  readonly spec?: ParserSpec
  readonly emulator?: TerminalEmulator
  readonly c1Handling?: C1HandlingMode
  readonly maxStringLength?: number
  readonly acceptEightBitControls?: boolean
  readonly stringLimits?: Partial<ParserStringLimits>
}

export type ParserOptionOverrides = Partial<
  Pick<
    ParserOptions,
    'c1Handling' | 'acceptEightBitControls' | 'maxStringLength' | 'stringLimits'
  >
>

export interface TerminalFeatures {
  readonly initialRows: number
  readonly initialColumns: number
  readonly supportsAnsiColors: boolean
  readonly supportsDecPrivateModes: boolean
  readonly supportsSosPmApc: boolean
  readonly supportsTabStops: boolean
  readonly supportsScrollRegions: boolean
  readonly supportsOriginMode: boolean
  readonly supportsAutoWrap: boolean
  readonly supportsCursorVisibility: boolean
  readonly supportsC1TransmissionToggle: boolean
  readonly defaultC1Transmission: C1TransmissionMode
  readonly primaryDeviceAttributes: string
  readonly secondaryDeviceAttributes: string | null
  readonly supportsNationalReplacementCharsets: boolean
}

export interface TerminalCapabilities {
  readonly spec: ParserSpec
  readonly emulator?: TerminalEmulator
  readonly features: TerminalFeatures
}

export type SosPmApcKind = 'SOS' | 'PM' | 'APC'

export interface ParserStringLimits {
  /**
   * Maximum byte length for OSC payloads (e.g. `ESC ] 52 ;...` clipboard writes).
   * If an application spams a 10 KB title string and `osc` is 4096, the parser
   * cancels the sequence before dispatch. Raising it to, e.g. 16384 lets the full
   * payload through for xterm-style features.
   */
  readonly osc: number
  /**
   * Maximum bytes buffered between `DcsHook` and `DcsUnhook` (e.g. Sixel or
   * DECSLRM packets). Leaving this at 4096 stops runaway graphics dumps; bumping
   * it to 8192 accommodates larger Sixel images without truncation.
   */
  readonly dcs: number
  /**
   * Cap for Start of String (SOS)/Privacy Message (PM)/Application Program Command
   * (APC) strings (status messages and application commands). Shell integrations
   * that emit long hyperlinks may exceed 2048 bytes—raising `sosPmApc` keeps those
   * intact, while lowering it guards against rogue status spam.
   */
  readonly sosPmApc: number
}

/**
 * Public interface for parser instances.
 */
export interface Parser {
  readonly state: ParserState
  write(input: Uint8Array | string, sink: ParserEventSink): void
  reset(): void
  setC1TransmissionMode(mode: C1TransmissionMode): void
}

export type C1TransmissionMode = '7-bit' | '8-bit'
