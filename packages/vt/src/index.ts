/** biome-ignore-all lint/performance/noBarrelFile: Library */

export { resolveTerminalCapabilities } from './capabilities'
export { classifyByte } from './classifier'
export { resolveEmulatorOverlay } from './internal/emulator-quirks'
export { resolveParserOptions } from './internal/resolve-options'
export { SPEC_DEFAULTS, SPEC_FALLBACK } from './internal/spec-defaults'
export {
  createInterpreter,
  TerminalInterpreter,
} from './interpreter'
export type { CellDelta, TerminalUpdate } from './interpreter-internals/delta'
export type {
  SelectionBounds,
  SelectionKind,
  SelectionPoint,
  SelectionRange,
  SelectionRowSegment,
  SelectionStatus,
  TerminalSelection,
} from './interpreter-internals/selection'
export {
  areSelectionsEqual,
  clampSelectionRange,
  getSelectionBounds,
  getSelectionRange,
  getSelectionRowSegment,
  getSelectionRowSegments,
  isSelectionCollapsed,
} from './interpreter-internals/selection'
export type {
  ClipboardEntry,
  CursorPosition,
  TerminalAttributes,
  TerminalCell,
  TerminalColor,
  TerminalState,
} from './interpreter-internals/state'
export { createParser } from './parser'
export type { PrinterController } from './printer/controller'
export { createNoopPrinterController } from './printer/controller'
export type {
  ByteFlag,
  C1HandlingMode,
  C1TransmissionMode,
  Parser,
  ParserEvent,
  ParserEventSink,
  ParserEventType,
  ParserOptionOverrides,
  ParserOptions,
  ParserSpec,
  ParserState,
  ParserStringLimits,
  SosPmApcKind,
  TerminalCapabilities,
  TerminalEmulator,
  TerminalFeatures,
} from './types'
