/** biome-ignore-all lint/performance/noBarrelFile: Library */
export { classifyByte } from './classifier'
export { createParser } from './parser'
export { SPEC_DEFAULTS, SPEC_FALLBACK } from './internal/spec-defaults'
export type {
  ByteFlag,
  C1HandlingMode,
  Parser,
  ParserEvent,
  ParserEventSink,
  ParserEventType,
  ParserOptions,
  ParserSpec,
  ParserStringLimits,
  ParserState,
  SosPmApcKind,
} from './types'
