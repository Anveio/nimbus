/** biome-ignore-all lint/performance/noBarrelFile: Library */
export { classifyByte } from './classifier'
export { createParser } from './parser'
export { SPEC_DEFAULTS, SPEC_FALLBACK } from './internal/spec-defaults'
export { resolveParserOptions } from './internal/resolve-options'
export { resolveEmulatorOverlay } from './internal/emulator-quirks'
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
  ParserStringLimits,
  ParserState,
  SosPmApcKind,
} from './types'
