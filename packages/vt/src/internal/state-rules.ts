import {
  ByteFlag,
  type ParserEventSink,
  ParserState,
  type SosPmApcKind,
} from '../types'

export const BYTE_TABLE_SIZE = 256

export const CONTROL_BYTES = {
  ESC: 0x1b,
  CAN: 0x18,
  SUB: 0x1a,
  BEL: 0x07,
}

export const BYTE_LIMITS = {
  INTERMEDIATE_START: 0x20,
  INTERMEDIATE_END: 0x2f,
  PARAM_START: 0x30,
  PARAM_END: 0x3f,
  DIGIT_START: 0x30,
  DIGIT_END: 0x39,
  FINAL_START: 0x40,
  FINAL_END: 0x7e,
  DELETE: 0x7f,
  COLON: 0x3a,
  SEMICOLON: 0x3b,
}

export type ByteHandler = (byte: number, sink: ParserEventSink) => void
export type ByteRulePredicate = (byte: number, flags: ByteFlag) => boolean

export interface ByteRule {
  readonly predicate: ByteRulePredicate
  readonly handler: ByteHandler
}

export interface StateRuleSpec {
  readonly fallback: ByteHandler
  readonly rules: ReadonlyArray<ByteRule>
}

export type StateRuleSpecMap = Record<ParserState, StateRuleSpec>

export interface StateRuleRuntime {
  readonly maxIntermediateCount: number
  readonly noop: ByteHandler
  isEightBitControlsEnabled(): boolean
  pushPrint(byte: number): void
  flushPrint(sink: ParserEventSink): void
  emitExecute(byte: number, sink: ParserEventSink): void
  handleC1(byte: number, sink: ParserEventSink): void
  setState(state: ParserState): void
  resetIntermediates(): void
  addIntermediate(byte: number): void
  getIntermediateCount(): number
  getPrefix(): number | null
  setPrefix(value: number | null): void
  enterCsiEntry(): void
  enterOscString(): void
  enterDcsEntry(): void
  enterSosPmApc(kind: SosPmApcKind): void
  emitEscDispatch(byte: number, sink: ParserEventSink): void
  enterCsiIgnore(): void
  finalizeCsi(byte: number, sink: ParserEventSink): void
  cancelCsi(): void
  resetCsiContext(): void
  handleCsiParamDigit(byte: number): void
  pushCurrentParam(separator: 'colon' | 'semicolon'): void
  enterDcsIgnore(): void
  cancelDcs(): void
  resetParamContext(): void
  finalizeDcs(byte: number, sink: ParserEventSink): void
  handleDcsParamDigit(byte: number): void
  processDcsParamByte(byte: number, sink?: ParserEventSink): void
  handleDcsPassthrough(byte: number, sink: ParserEventSink): void
  handleOscByte(byte: number, sink: ParserEventSink): void
  handleSosPmApcByte(byte: number, sink: ParserEventSink): void
}

export const matchBytes = (...codes: number[]): ByteRulePredicate => {
  const set = new Set(codes)
  return (byte) => set.has(byte)
}

export const matchRange =
  (start: number, end: number): ByteRulePredicate =>
  (byte) =>
    byte >= start && byte <= end

export const matchFlag =
  (flag: ByteFlag): ByteRulePredicate =>
  (_byte, flags) =>
    (flags & flag) !== 0

export const matchAnyFlag =
  (mask: ByteFlag): ByteRulePredicate =>
  (_byte, flags) =>
    (flags & mask) !== 0

export const matchDigits: ByteRulePredicate = (byte) =>
  byte >= BYTE_LIMITS.DIGIT_START && byte <= BYTE_LIMITS.DIGIT_END

export const matchPrivatePrefixes: ByteRulePredicate = (byte) =>
  byte >= 0x3c && byte <= 0x3f

export const matchParamSeparators: ByteRulePredicate = matchBytes(
  BYTE_LIMITS.COLON,
  BYTE_LIMITS.SEMICOLON,
)

export const matchParamDigitsOrSeparators: ByteRulePredicate = (byte) =>
  byte >= BYTE_LIMITS.DIGIT_START &&
  byte <= BYTE_LIMITS.SEMICOLON &&
  byte !== 0x3c &&
  byte !== 0x3d &&
  byte !== 0x3e &&
  byte !== 0x3f

export const createStateRuleSpecs = (
  runtime: StateRuleRuntime,
): StateRuleSpecMap => ({
  [ParserState.Ground]: createGroundSpec(runtime),
  [ParserState.Escape]: createEscapeSpec(runtime),
  [ParserState.EscapeIntermediate]: createEscapeIntermediateSpec(runtime),
  [ParserState.CsiEntry]: createCsiEntrySpec(runtime),
  [ParserState.CsiParam]: createCsiParamSpec(runtime),
  [ParserState.CsiIntermediate]: createCsiIntermediateSpec(runtime),
  [ParserState.CsiIgnore]: createCsiIgnoreSpec(runtime),
  [ParserState.OscString]: createOscSpec(runtime),
  [ParserState.DcsEntry]: createDcsEntrySpec(runtime),
  [ParserState.DcsParam]: createDcsParamSpec(runtime),
  [ParserState.DcsIntermediate]: createDcsIntermediateSpec(runtime),
  [ParserState.DcsIgnore]: createDcsIgnoreSpec(runtime),
  [ParserState.DcsPassthrough]: createDcsPassthroughSpec(runtime),
  [ParserState.SosPmApcString]: createSosPmApcSpec(runtime),
})

const createGroundSpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC } = CONTROL_BYTES

  const enterEscape: ByteHandler = (_byte, sink) => {
    runtime.flushPrint(sink)
    runtime.setState(ParserState.Escape)
    runtime.resetIntermediates()
  }

  const executeControl: ByteHandler = (byte, sink) => {
    runtime.flushPrint(sink)
    runtime.emitExecute(byte, sink)
  }

  const printable: ByteHandler = (byte) => {
    runtime.pushPrint(byte)
  }

  const handleC1: ByteHandler = (byte, sink) => {
    if (runtime.isEightBitControlsEnabled()) {
      runtime.handleC1(byte, sink)
      return
    }
    runtime.noop(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(ESC), handler: enterEscape },
    {
      predicate: (byte, flags) =>
        byte !== ESC &&
        ((flags & ByteFlag.C0Control) !== 0 || (flags & ByteFlag.Delete) !== 0),
      handler: executeControl,
    },
    { predicate: matchFlag(ByteFlag.Printable), handler: printable },
    { predicate: matchFlag(ByteFlag.C1Control), handler: handleC1 },
  ]

  return {
    fallback: runtime.noop,
    rules,
  }
}

const createEscapeSpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const dropToGround: ByteHandler = () => {
    runtime.setState(ParserState.Ground)
  }

  const collectIntermediate: ByteHandler = (byte) => {
    runtime.addIntermediate(byte)
    runtime.setState(ParserState.EscapeIntermediate)
  }

  const dispatchEscape: ByteHandler = (byte, sink) => {
    runtime.emitEscDispatch(byte, sink)
    runtime.setState(ParserState.Ground)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(0x5b), handler: runtime.enterCsiEntry },
    { predicate: matchBytes(0x5d), handler: runtime.enterOscString },
    { predicate: matchBytes(0x50), handler: runtime.enterDcsEntry },
    {
      predicate: matchBytes(0x58),
      handler: () => runtime.enterSosPmApc('SOS'),
    },
    { predicate: matchBytes(0x5e), handler: () => runtime.enterSosPmApc('PM') },
    {
      predicate: matchBytes(0x5f),
      handler: () => runtime.enterSosPmApc('APC'),
    },
    {
      predicate: matchFlag(ByteFlag.Intermediate),
      handler: collectIntermediate,
    },
    {
      predicate: matchAnyFlag(ByteFlag.Parameter | ByteFlag.Final),
      handler: dispatchEscape,
    },
  ]

  return { fallback: dropToGround, rules }
}

const createEscapeIntermediateSpec = (
  runtime: StateRuleRuntime,
): StateRuleSpec => {
  const toGround: ByteHandler = () => {
    runtime.setState(ParserState.Ground)
  }

  const collect: ByteHandler = (byte) => {
    runtime.addIntermediate(byte)
  }

  const dispatch: ByteHandler = (byte, sink) => {
    runtime.emitEscDispatch(byte, sink)
    runtime.setState(ParserState.Ground)
  }

  const rules: ByteRule[] = [
    { predicate: matchFlag(ByteFlag.Intermediate), handler: collect },
    {
      predicate: matchAnyFlag(ByteFlag.Parameter | ByteFlag.Final),
      handler: dispatch,
    },
  ]

  return { fallback: toGround, rules }
}

const createCsiEntrySpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES
  const { COLON, SEMICOLON } = BYTE_LIMITS

  const cancel: ByteHandler = () => {
    runtime.cancelCsi()
  }

  const setToEscape: ByteHandler = () => {
    runtime.resetCsiContext()
    runtime.setState(ParserState.Escape)
  }

  const recordPrefix: ByteHandler = (byte) => {
    if (runtime.getPrefix() === null) {
      runtime.setPrefix(byte)
    } else {
      runtime.enterCsiIgnore()
    }
  }

  const enterParamWithDigit: ByteHandler = (byte) => {
    runtime.setState(ParserState.CsiParam)
    runtime.handleCsiParamDigit(byte)
  }

  const enterParamWithColon: ByteHandler = () => {
    runtime.setState(ParserState.CsiParam)
    runtime.pushCurrentParam('colon')
  }

  const enterParamWithSemicolon: ByteHandler = () => {
    runtime.setState(ParserState.CsiParam)
    runtime.pushCurrentParam('semicolon')
  }

  const moveToIntermediate: ByteHandler = (byte) => {
    if (runtime.getIntermediateCount() >= runtime.maxIntermediateCount) {
      runtime.enterCsiIgnore()
      return
    }
    runtime.addIntermediate(byte)
    runtime.setState(ParserState.CsiIntermediate)
  }

  const dispatchFinal: ByteHandler = (byte, sink) => {
    runtime.finalizeCsi(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: cancel },
    { predicate: matchBytes(ESC), handler: setToEscape },
    { predicate: matchPrivatePrefixes, handler: recordPrefix },
    { predicate: matchDigits, handler: enterParamWithDigit },
    { predicate: matchBytes(COLON), handler: enterParamWithColon },
    { predicate: matchBytes(SEMICOLON), handler: enterParamWithSemicolon },
    {
      predicate: matchFlag(ByteFlag.Intermediate),
      handler: moveToIntermediate,
    },
    { predicate: matchFlag(ByteFlag.Final), handler: dispatchFinal },
  ]

  return { fallback: cancel, rules }
}

const createCsiParamSpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES
  const { COLON, SEMICOLON } = BYTE_LIMITS

  const ignore: ByteHandler = () => {
    runtime.enterCsiIgnore()
  }

  const cancel: ByteHandler = () => {
    runtime.cancelCsi()
  }

  const setToEscape: ByteHandler = () => {
    runtime.resetCsiContext()
    runtime.setState(ParserState.Escape)
  }

  const digit: ByteHandler = (byte) => {
    runtime.handleCsiParamDigit(byte)
  }

  const colonSeparator: ByteHandler = () => {
    runtime.pushCurrentParam('colon')
  }

  const semicolonSeparator: ByteHandler = () => {
    runtime.pushCurrentParam('semicolon')
  }

  const toIntermediate: ByteHandler = (byte) => {
    if (runtime.getIntermediateCount() >= runtime.maxIntermediateCount) {
      runtime.enterCsiIgnore()
      return
    }
    runtime.addIntermediate(byte)
    runtime.setState(ParserState.CsiIntermediate)
  }

  const dispatchFinal: ByteHandler = (byte, sink) => {
    runtime.finalizeCsi(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: cancel },
    { predicate: matchBytes(ESC), handler: setToEscape },
    { predicate: matchDigits, handler: digit },
    { predicate: matchBytes(COLON), handler: colonSeparator },
    { predicate: matchBytes(SEMICOLON), handler: semicolonSeparator },
    { predicate: matchFlag(ByteFlag.Intermediate), handler: toIntermediate },
    { predicate: matchFlag(ByteFlag.Final), handler: dispatchFinal },
  ]

  return { fallback: ignore, rules }
}

const createCsiIntermediateSpec = (
  runtime: StateRuleRuntime,
): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES

  const ignoreHandler: ByteHandler = () => {
    runtime.enterCsiIgnore()
  }

  const cancel: ByteHandler = () => {
    runtime.cancelCsi()
  }

  const setToEscape: ByteHandler = () => {
    runtime.resetCsiContext()
    runtime.setState(ParserState.Escape)
  }

  const collect: ByteHandler = (byte) => {
    if (runtime.getIntermediateCount() >= runtime.maxIntermediateCount) {
      runtime.enterCsiIgnore()
      return
    }
    runtime.addIntermediate(byte)
  }

  const dispatch: ByteHandler = (byte, sink) => {
    runtime.finalizeCsi(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: cancel },
    { predicate: matchBytes(ESC), handler: setToEscape },
    { predicate: matchFlag(ByteFlag.Intermediate), handler: collect },
    { predicate: matchFlag(ByteFlag.Final), handler: dispatch },
  ]

  return { fallback: ignoreHandler, rules }
}

const createCsiIgnoreSpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES

  const stay: ByteHandler = () => {}

  const toGround: ByteHandler = () => {
    runtime.setState(ParserState.Ground)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: toGround },
    {
      predicate: matchBytes(ESC),
      handler: () => {
        runtime.setState(ParserState.Escape)
      },
    },
    { predicate: matchFlag(ByteFlag.Final), handler: toGround },
  ]

  return { fallback: stay, rules }
}

const createOscSpec = (runtime: StateRuleRuntime): StateRuleSpec => ({
  fallback: runtime.handleOscByte,
  rules: [],
})

const createDcsEntrySpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES
  const toIgnore: ByteHandler = () => {
    runtime.enterDcsIgnore()
  }

  const cancel: ByteHandler = () => {
    runtime.cancelDcs()
  }

  const setToEscape: ByteHandler = () => {
    runtime.resetParamContext()
    runtime.setState(ParserState.Escape)
  }

  const recordPrefix: ByteHandler = (byte) => {
    if (runtime.getPrefix() === null) {
      runtime.setPrefix(byte)
    } else {
      runtime.enterDcsIgnore()
    }
  }

  const enterParam: ByteHandler = (byte, sink) => {
    runtime.setState(ParserState.DcsParam)
    runtime.processDcsParamByte(byte, sink)
  }

  const enterIntermediate: ByteHandler = (byte) => {
    if (runtime.getIntermediateCount() >= runtime.maxIntermediateCount) {
      runtime.enterDcsIgnore()
      return
    }
    runtime.addIntermediate(byte)
    runtime.setState(ParserState.DcsIntermediate)
  }

  const dispatch: ByteHandler = (byte, sink) => {
    runtime.finalizeDcs(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: cancel },
    { predicate: matchBytes(ESC), handler: setToEscape },
    { predicate: matchPrivatePrefixes, handler: recordPrefix },
    { predicate: matchParamDigitsOrSeparators, handler: enterParam },
    { predicate: matchFlag(ByteFlag.Intermediate), handler: enterIntermediate },
    { predicate: matchFlag(ByteFlag.Final), handler: dispatch },
  ]

  return { fallback: toIgnore, rules }
}

const createDcsParamSpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES
  const { COLON } = BYTE_LIMITS

  const toIgnore: ByteHandler = () => {
    runtime.enterDcsIgnore()
  }

  const cancel: ByteHandler = () => {
    runtime.cancelDcs()
  }

  const setToEscape: ByteHandler = () => {
    runtime.resetParamContext()
    runtime.setState(ParserState.Escape)
  }

  const digit: ByteHandler = (byte) => {
    runtime.handleDcsParamDigit(byte)
  }

  const separator: ByteHandler = (byte) => {
    runtime.pushCurrentParam(byte === COLON ? 'colon' : 'semicolon')
  }

  const toIntermediate: ByteHandler = (byte) => {
    if (runtime.getIntermediateCount() >= runtime.maxIntermediateCount) {
      runtime.enterDcsIgnore()
      return
    }
    runtime.addIntermediate(byte)
    runtime.setState(ParserState.DcsIntermediate)
  }

  const dispatch: ByteHandler = (byte, sink) => {
    runtime.finalizeDcs(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: cancel },
    { predicate: matchBytes(ESC), handler: setToEscape },
    { predicate: matchDigits, handler: digit },
    { predicate: matchParamSeparators, handler: separator },
    { predicate: matchFlag(ByteFlag.Intermediate), handler: toIntermediate },
    { predicate: matchFlag(ByteFlag.Final), handler: dispatch },
  ]

  return { fallback: toIgnore, rules }
}

const createDcsIntermediateSpec = (
  runtime: StateRuleRuntime,
): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES

  const toIgnore: ByteHandler = () => {
    runtime.enterDcsIgnore()
  }

  const cancel: ByteHandler = () => {
    runtime.cancelDcs()
  }

  const setToEscape: ByteHandler = () => {
    runtime.resetParamContext()
    runtime.setState(ParserState.Escape)
  }

  const collect: ByteHandler = (byte) => {
    if (runtime.getIntermediateCount() >= runtime.maxIntermediateCount) {
      runtime.enterDcsIgnore()
      return
    }
    runtime.addIntermediate(byte)
  }

  const dispatch: ByteHandler = (byte, sink) => {
    runtime.finalizeDcs(byte, sink)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: cancel },
    { predicate: matchBytes(ESC), handler: setToEscape },
    { predicate: matchFlag(ByteFlag.Intermediate), handler: collect },
    { predicate: matchFlag(ByteFlag.Final), handler: dispatch },
  ]

  return { fallback: toIgnore, rules }
}

const createDcsIgnoreSpec = (runtime: StateRuleRuntime): StateRuleSpec => {
  const { ESC, CAN, SUB } = CONTROL_BYTES

  const stay: ByteHandler = () => {}

  const toGround: ByteHandler = () => {
    runtime.setState(ParserState.Ground)
  }

  const rules: ByteRule[] = [
    { predicate: matchBytes(CAN, SUB), handler: toGround },
    {
      predicate: matchBytes(ESC),
      handler: () => {
        runtime.setState(ParserState.Escape)
      },
    },
    { predicate: matchFlag(ByteFlag.Final), handler: toGround },
  ]

  return { fallback: stay, rules }
}

const createDcsPassthroughSpec = (
  runtime: StateRuleRuntime,
): StateRuleSpec => ({
  fallback: runtime.handleDcsPassthrough,
  rules: [],
})

const createSosPmApcSpec = (runtime: StateRuleRuntime): StateRuleSpec => ({
  fallback: runtime.handleSosPmApcByte,
  rules: [],
})
