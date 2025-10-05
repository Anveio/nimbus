/** biome-ignore-all lint/performance/noBarrelFile: Library */

export type {
  CellDelta,
  ClipboardEntry,
  CursorPosition,
  InterpreterOptions,
  SelectionBounds,
  SelectionKind,
  SelectionPoint,
  SelectionRange,
  SelectionRowSegment,
  SelectionStatus,
  TerminalAttributes,
  TerminalCell,
  TerminalColor,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from './interpreter'
export {
  areSelectionsEqual,
  clampSelectionRange,
  createInterpreter,
  getSelectionBounds,
  getSelectionRange,
  getSelectionRowSegment,
  getSelectionRowSegments,
  isSelectionCollapsed,
  TerminalInterpreter,
} from './interpreter'
export { createParser } from './parser'
export type {
  TerminalRuntime,
  TerminalRuntimeCursorMoveDirection,
  TerminalRuntimeCursorMoveOptions,
  TerminalRuntimeEvent as TerminalRuntimeHostEvent,
  TerminalRuntimeOptions,
} from './runtime'

export { createTerminalRuntime, parser } from './runtime'
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
export type { PrinterController } from './utils/printer'
