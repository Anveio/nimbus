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
  TerminalInterpreter,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from './interpreter'

export type {
  TerminalPointerButton,
  TerminalPointerModifierState,
  TerminalRuntime,
  TerminalRuntimeCursorMoveDirection,
  TerminalRuntimeCursorMoveOptions,
  TerminalRuntimeEvent as TerminalRuntimeHostEvent,
  TerminalRuntimeOptions,
  TerminalRuntimePointerEvent,
  TerminalRuntimeWheelEvent,
} from './runtime'
export {
  createTerminalRuntime,
  parser,
} from './runtime'

export {
  areSelectionsEqual,
  clampSelectionRange,
  getSelectionBounds,
  getSelectionRange,
  getSelectionRowSegment,
  getSelectionRowSegments,
  isSelectionCollapsed,
} from './interpreter'

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
