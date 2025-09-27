/** biome-ignore-all lint/performance/noBarrelFile: Library */
export { classifyByte } from './classifier'
export { createParser } from './parser'
export { SPEC_DEFAULTS, SPEC_FALLBACK } from './internal/spec-defaults'
export { resolveParserOptions } from './internal/resolve-options'
export { resolveEmulatorOverlay } from './internal/emulator-quirks'
export { resolveTerminalCapabilities } from './capabilities'
export {
  createInterpreter,
  TerminalInterpreter,
} from './interpreter/terminal-interpreter'
export type {
  ByteFlag,
  C1HandlingMode,
  Parser,
  ParserEvent,
  ParserEventSink,
  ParserEventType,
  ParserOptions,
  ParserOptionOverrides,
  ParserSpec,
  TerminalEmulator,
  TerminalCapabilities,
  TerminalFeatures,
  ParserStringLimits,
  ParserState,
  SosPmApcKind,
} from './types'
export type {
  TerminalAttributes,
  TerminalCell,
  CursorPosition,
  TerminalState,
} from './interpreter/state'
export type { CellDelta, TerminalUpdate } from './interpreter/delta'
