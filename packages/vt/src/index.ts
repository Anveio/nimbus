/** biome-ignore-all lint/performance/noBarrelFile: Library */

export { resolveTerminalCapabilities } from './capabilities'
export { classifyByte } from './classifier'
export { resolveEmulatorOverlay } from './internal/emulator-quirks'
export { resolveParserOptions } from './internal/resolve-options'
export { SPEC_DEFAULTS, SPEC_FALLBACK } from './internal/spec-defaults'
export type { CellDelta, TerminalUpdate } from './interpreter/delta'
export type {
  CursorPosition,
  ClipboardEntry,
  TerminalAttributes,
  TerminalColor,
  TerminalCell,
  TerminalState,
} from './interpreter/state'
export {
  getSelectionBounds,
  getSelectionRowSegment,
  getSelectionRowSegments,
  isSelectionCollapsed,
  areSelectionsEqual,
  getSelectionRange,
  clampSelectionRange,
} from './interpreter/selection'
export type {
  SelectionBounds,
  SelectionKind,
  SelectionPoint,
  SelectionRowSegment,
  SelectionStatus,
  TerminalSelection,
  SelectionRange,
} from './interpreter/selection'
export {
  createInterpreter,
  TerminalInterpreter,
} from './interpreter/terminal-interpreter'
export { createParser } from './parser'
export type {
  ByteFlag,
  C1HandlingMode,
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
