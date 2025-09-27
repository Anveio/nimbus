import { classifyByte } from './classifier'
import { BYTE_TO_C1_ACTION } from './internal/c1-table'
import { createInitialContext } from './internal/context'
import {
  ByteFlag,
  type C1HandlingMode,
  type Parser,
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  type ParserOptions,
  ParserState,
  type SosPmApcKind,
} from './types'

const ESC = 0x1b
const CSI_8BIT = 0x9b
const OSC_8BIT = 0x9d
const ST_8BIT = 0x9c
const CAN = 0x18
const SUB = 0x1a
const BEL = 0x07
const DCS_8BIT = 0x90
const SOS_8BIT = 0x98
const PM_8BIT = 0x9e
const APC_8BIT = 0x9f
const MAX_CSI_PARAMS = 16
const MAX_CSI_INTERMEDIATES = 4
const MAX_CSI_PARAM_VALUE = 65535
const DEFAULT_C1_MODE: C1HandlingMode = 'spec'
const DEFAULT_MAX_STRING_LENGTH = 4096
const DCS_CHUNK_SIZE = 1024
const BYTE_TABLE_SIZE = 256
const INTERMEDIATE_START = 0x20
const INTERMEDIATE_END = 0x2f
const PARAM_START = 0x30
const PARAM_END = 0x3f
const DIGIT_START = 0x30
const DIGIT_END = 0x39
const FINAL_START = 0x40
const FINAL_END = 0x7e
const COLON = 0x3a
const SEMICOLON = 0x3b
const BACKSLASH = 0x5c
const DELETE = 0x7f

type ByteHandler = (byte: number, sink: ParserEventSink) => void
type ByteRulePredicate = (byte: number, flags: ByteFlag) => boolean

interface ByteRule {
  readonly predicate: ByteRulePredicate
  readonly handler: ByteHandler
}

const matchBytes = (...codes: number[]): ByteRulePredicate => {
  const set = new Set(codes)
  return (byte) => set.has(byte)
}

const matchRange =
  (start: number, end: number): ByteRulePredicate =>
  (byte) =>
    byte >= start && byte <= end

const matchFlag =
  (flag: ByteFlag): ByteRulePredicate =>
  (_byte, flags) =>
    (flags & flag) !== 0

class ParserImpl implements Parser {
  private context = createInitialContext()
  private readonly encoder = new TextEncoder()
  private printBuffer: number[] = []
  private readonly c1Mode: C1HandlingMode
  private readonly maxStringLength: number
  private readonly acceptEightBitControls: boolean
  private readonly dispatchTable: Record<
    ParserState,
    ReadonlyArray<ByteHandler>
  >
  private readonly noopHandler: ByteHandler = () => {}

  constructor(options: ParserOptions = {}) {
    this.c1Mode = options.c1Handling ?? DEFAULT_C1_MODE
    this.maxStringLength =
      options.maxStringLength && options.maxStringLength > 0
        ? options.maxStringLength
        : DEFAULT_MAX_STRING_LENGTH
    this.acceptEightBitControls = options.acceptEightBitControls ?? true
    this.dispatchTable = this.buildDispatchTable()
  }

  get state(): ParserState {
    return this.context.state
  }

  write(input: Uint8Array | string, sink: ParserEventSink): void {
    const buffer =
      typeof input === 'string' ? this.encoder.encode(input) : input

    for (const byte of buffer) {
      this.processByte(byte, sink)
    }

    this.flushPrint(sink)
  }

  reset(): void {
    this.context = createInitialContext()
    this.printBuffer = []
  }

  private processByte(byte: number, sink: ParserEventSink): void {
    const table = this.dispatchTable[this.context.state]
    const handler = table?.[byte] ?? this.noopHandler
    handler(byte, sink)
  }

  private dispatchStateByte(
    state: ParserState,
    byte: number,
    sink: ParserEventSink,
  ): void {
    const handler = this.dispatchTable[state]?.[byte] ?? this.noopHandler
    handler(byte, sink)
  }

  private buildRowFromRules(
    rules: ReadonlyArray<ByteRule>,
    fallback: ByteHandler = this.noopHandler,
  ): ByteHandler[] {
    const row = new Array<ByteHandler>(BYTE_TABLE_SIZE)
    for (let code = 0; code < BYTE_TABLE_SIZE; code += 1) {
      const flags = classifyByte(code)
      let handler = fallback
      for (const rule of rules) {
        if (rule.predicate(code, flags)) {
          handler = rule.handler
          break
        }
      }
      row[code] = handler
    }
    return row
  }

  private buildDispatchTable(): Record<
    ParserState,
    ReadonlyArray<ByteHandler>
  > {
    return {
      [ParserState.Ground]: this.createGroundRow(),
      [ParserState.Escape]: this.createEscapeRow(),
      [ParserState.EscapeIntermediate]: this.createEscapeIntermediateRow(),
      [ParserState.CsiEntry]: this.createCsiEntryRow(),
      [ParserState.CsiParam]: this.createCsiParamRow(),
      [ParserState.CsiIntermediate]: this.createCsiIntermediateRow(),
      [ParserState.CsiIgnore]: this.createCsiIgnoreRow(),
      [ParserState.OscString]: this.createOscRow(),
      [ParserState.DcsEntry]: this.createDcsEntryRow(),
      [ParserState.DcsParam]: this.createDcsParamRow(),
      [ParserState.DcsIntermediate]: this.createDcsIntermediateRow(),
      [ParserState.DcsIgnore]: this.createDcsIgnoreRow(),
      [ParserState.DcsPassthrough]: this.createDcsPassthroughRow(),
      [ParserState.SosPmApcString]: this.createSosPmApcRow(),
    }
  }

  private createGroundRow(): ByteHandler[] {
    const enterEscape: ByteHandler = (_byte, sink) => {
      this.flushPrint(sink)
      this.context.state = ParserState.Escape
      this.resetIntermediates()
    }

    const executeControl: ByteHandler = (byte, sink) => {
      this.flushPrint(sink)
      this.emitExecute(byte, sink)
    }

    const printable: ByteHandler = (byte) => {
      this.printBuffer.push(byte)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(ESC), handler: enterEscape },
      {
        predicate: (byte, flags) =>
          byte !== ESC &&
          ((flags & ByteFlag.C0Control) !== 0 ||
            (flags & ByteFlag.Delete) !== 0),
        handler: executeControl,
      },
      { predicate: matchFlag(ByteFlag.Printable), handler: printable },
    ]

    if (this.acceptEightBitControls) {
      const c1Handler: ByteHandler = (byte, sink) => {
        this.handleC1(byte, sink)
      }
      rules.push({
        predicate: matchFlag(ByteFlag.C1Control),
        handler: c1Handler,
      })
    }

    return this.buildRowFromRules(rules)
  }

  private createEscapeRow(): ByteHandler[] {
    const dropToGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }

    const collectIntermediate: ByteHandler = (byte) => {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.EscapeIntermediate
    }

    const dispatchEscape: ByteHandler = (byte, sink) => {
      this.emitEscDispatch(byte, sink)
      this.context.state = ParserState.Ground
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(0x5b), handler: () => this.enterCsiEntry() },
      { predicate: matchBytes(0x5d), handler: () => this.enterOscString() },
      { predicate: matchBytes(0x50), handler: () => this.enterDcsEntry() },
      { predicate: matchBytes(0x58), handler: () => this.enterSosPmApc('SOS') },
      { predicate: matchBytes(0x5e), handler: () => this.enterSosPmApc('PM') },
      { predicate: matchBytes(0x5f), handler: () => this.enterSosPmApc('APC') },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: collectIntermediate,
      },
      {
        predicate: matchRange(PARAM_START, FINAL_END),
        handler: dispatchEscape,
      },
    ]

    return this.buildRowFromRules(rules, dropToGround)
  }

  private createEscapeIntermediateRow(): ByteHandler[] {
    const toGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }

    const collect: ByteHandler = (byte) => {
      this.context.intermediates.push(byte)
    }

    const dispatch: ByteHandler = (byte, sink) => {
      this.emitEscDispatch(byte, sink)
      this.context.state = ParserState.Ground
    }

    const rules: ByteRule[] = [
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: collect,
      },
      { predicate: matchRange(PARAM_START, FINAL_END), handler: dispatch },
    ]

    return this.buildRowFromRules(rules, toGround)
  }

  private createCsiEntryRow(): ByteHandler[] {
    const cancel: ByteHandler = () => {
      this.cancelCsi()
    }

    const setToEscape: ByteHandler = () => {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
    }

    const recordPrefix: ByteHandler = (byte) => {
      if (this.context.prefix === null) {
        this.context.prefix = byte
      } else {
        this.enterCsiIgnore()
      }
    }

    const recordDigit: ByteHandler = (byte) => {
      this.handleCsiParamDigit(byte)
    }
    const enterParamWithDigit = this.transitionTo(
      ParserState.CsiParam,
      recordDigit,
    )

    const pushParam: ByteHandler = () => {
      this.pushCurrentParam()
    }
    const enterParamAndPush = this.transitionTo(ParserState.CsiParam, pushParam)

    const enterIntermediate: ByteHandler = (byte) => {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterCsiIgnore()
        return
      }
      this.context.intermediates.push(byte)
    }
    const moveToIntermediate = this.transitionTo(
      ParserState.CsiIntermediate,
      enterIntermediate,
    )

    const dispatchFinal: ByteHandler = (byte, sink) => {
      this.finalizeCsi(byte, sink)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: cancel },
      { predicate: matchBytes(ESC), handler: setToEscape },
      { predicate: matchRange(0x3c, 0x3f), handler: recordPrefix },
      {
        predicate: matchRange(DIGIT_START, DIGIT_END),
        handler: enterParamWithDigit,
      },
      { predicate: matchBytes(COLON, SEMICOLON), handler: enterParamAndPush },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: moveToIntermediate,
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: dispatchFinal },
    ]

    return this.buildRowFromRules(rules, cancel)
  }

  private createCsiParamRow(): ByteHandler[] {
    const ignore: ByteHandler = () => {
      this.enterCsiIgnore()
    }

    const cancel: ByteHandler = () => {
      this.cancelCsi()
    }

    const setToEscape: ByteHandler = () => {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
    }

    const digit: ByteHandler = (byte) => {
      this.handleCsiParamDigit(byte)
    }

    const separator: ByteHandler = () => {
      this.pushCurrentParam()
    }

    const toIntermediate = this.transitionTo(
      ParserState.CsiIntermediate,
      (byte) => {
        if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
          this.enterCsiIgnore()
          return
        }
        this.context.intermediates.push(byte)
      },
    )

    const dispatchFinal: ByteHandler = (byte, sink) => {
      this.finalizeCsi(byte, sink)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: cancel },
      { predicate: matchBytes(ESC), handler: setToEscape },
      { predicate: matchRange(DIGIT_START, DIGIT_END), handler: digit },
      { predicate: matchBytes(COLON, SEMICOLON), handler: separator },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: toIntermediate,
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: dispatchFinal },
    ]

    return this.buildRowFromRules(rules, ignore)
  }

  private createCsiIntermediateRow(): ByteHandler[] {
    const ignoreHandler: ByteHandler = () => {
      this.enterCsiIgnore()
    }

    const cancelHandler: ByteHandler = () => {
      this.cancelCsi()
    }

    const setToEscape: ByteHandler = () => {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
    }

    const collectHandler: ByteHandler = (byte) => {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterCsiIgnore()
        return
      }
      this.context.intermediates.push(byte)
    }

    const finalHandler: ByteHandler = (byte, sink) => {
      this.finalizeCsi(byte, sink)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: cancelHandler },
      { predicate: matchBytes(ESC), handler: setToEscape },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: collectHandler,
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: finalHandler },
    ]

    return this.buildRowFromRules(rules, ignoreHandler)
  }

  private createCsiIgnoreRow(): ByteHandler[] {
    const stayHandler: ByteHandler = () => {}

    const toGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: toGround },
      {
        predicate: matchBytes(ESC),
        handler: (_byte) => {
          this.context.state = ParserState.Escape
        },
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: toGround },
    ]

    return this.buildRowFromRules(rules, stayHandler)
  }

  private createOscRow(): ByteHandler[] {
    const handler: ByteHandler = (byte, sink) => {
      this.handleOscString(byte, sink)
    }
    return this.buildRowFromRules([], handler)
  }

  private createDcsEntryRow(): ByteHandler[] {
    const toIgnore: ByteHandler = () => {
      this.enterDcsIgnore()
    }

    const cancel: ByteHandler = () => {
      this.cancelDcs()
    }

    const setToEscape: ByteHandler = () => {
      this.resetParamContext()
      this.context.state = ParserState.Escape
    }

    const recordPrefix: ByteHandler = (byte) => {
      if (this.context.prefix === null) {
        this.context.prefix = byte
      } else {
        this.enterDcsIgnore()
      }
    }

    const enterParam = this.transitionTo(ParserState.DcsParam, (byte, sink) => {
      this.processDcsParamByte(byte, sink)
    })

    const enterIntermediate = this.transitionTo(
      ParserState.DcsIntermediate,
      (byte) => {
        if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
          this.enterDcsIgnore()
          return
        }
        this.context.intermediates.push(byte)
      },
    )

    const dispatch: ByteHandler = (byte, sink) => {
      this.finalizeDcs(byte, sink)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: cancel },
      { predicate: matchBytes(ESC), handler: setToEscape },
      { predicate: matchRange(0x3c, 0x3f), handler: recordPrefix },
      { predicate: matchRange(PARAM_START, SEMICOLON), handler: enterParam },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: enterIntermediate,
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: dispatch },
    ]

    return this.buildRowFromRules(rules, toIgnore)
  }

  private createDcsParamRow(): ByteHandler[] {
    const toIgnore: ByteHandler = () => {
      this.enterDcsIgnore()
    }

    const cancel: ByteHandler = () => {
      this.cancelDcs()
    }

    const setToEscape: ByteHandler = () => {
      this.resetParamContext()
      this.context.state = ParserState.Escape
    }

    const digit: ByteHandler = (byte) => {
      this.handleDcsParamDigit(byte)
    }

    const separator: ByteHandler = () => {
      this.pushCurrentParam()
    }

    const toIntermediate = this.transitionTo(
      ParserState.DcsIntermediate,
      (byte) => {
        if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
          this.enterDcsIgnore()
          return
        }
        this.context.intermediates.push(byte)
      },
    )

    const dispatch: ByteHandler = (byte, sink) => {
      this.finalizeDcs(byte, sink)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: cancel },
      { predicate: matchBytes(ESC), handler: setToEscape },
      { predicate: matchRange(DIGIT_START, DIGIT_END), handler: digit },
      { predicate: matchBytes(COLON, SEMICOLON), handler: separator },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: toIntermediate,
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: dispatch },
    ]

    return this.buildRowFromRules(rules, toIgnore)
  }

  private createDcsIntermediateRow(): ByteHandler[] {
    const toIgnore: ByteHandler = () => {
      this.enterDcsIgnore()
    }

    const cancel: ByteHandler = () => {
      this.cancelDcs()
    }

    const setToEscape: ByteHandler = () => {
      this.resetParamContext()
      this.context.state = ParserState.Escape
    }

    const collect: ByteHandler = (byte) => {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterDcsIgnore()
        return
      }
      this.context.intermediates.push(byte)
    }

    const dispatch: ByteHandler = (byte, sink) => {
      this.finalizeDcs(byte, sink)
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: cancel },
      { predicate: matchBytes(ESC), handler: setToEscape },
      {
        predicate: matchRange(INTERMEDIATE_START, INTERMEDIATE_END),
        handler: collect,
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: dispatch },
    ]

    return this.buildRowFromRules(rules, toIgnore)
  }

  private createDcsIgnoreRow(): ByteHandler[] {
    const stay: ByteHandler = () => {}

    const toGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }

    const rules: ByteRule[] = [
      { predicate: matchBytes(CAN, SUB), handler: toGround },
      {
        predicate: matchBytes(ESC),
        handler: (_byte) => {
          this.context.state = ParserState.Escape
        },
      },
      { predicate: matchRange(FINAL_START, FINAL_END), handler: toGround },
    ]

    return this.buildRowFromRules(rules, stay)
  }

  private createDcsPassthroughRow(): ByteHandler[] {
    const handler: ByteHandler = (byte, sink) => {
      this.handleDcsPassthrough(byte, sink)
    }
    return this.buildRowFromRules([], handler)
  }

  private createSosPmApcRow(): ByteHandler[] {
    const handler: ByteHandler = (byte, sink) => {
      this.handleSosPmApcString(byte, sink)
    }
    return this.buildRowFromRules([], handler)
  }

  private transitionTo(
    state: ParserState,
    delegate?: ByteHandler,
  ): ByteHandler {
    return (byte, sink) => {
      this.context.state = state
      delegate?.(byte, sink)
    }
  }

  private handleC1(byte: number, sink: ParserEventSink): void {
    switch (this.c1Mode) {
      case 'spec':
        this.handleC1Spec(byte, sink)
        return
      case 'escaped':
        this.handleC1Escaped(byte, sink)
        return
      case 'execute':
        this.flushPrint(sink)
        this.emitExecute(byte, sink)
        return
      case 'ignore':
        this.flushPrint(sink)
        return
    }
  }

  private handleC1Spec(byte: number, sink: ParserEventSink): void {
    const action = BYTE_TO_C1_ACTION.get(byte)
    if (!action) {
      this.flushPrint(sink)
      this.emitExecute(byte, sink)
      return
    }

    this.flushPrint(sink)
    switch (action.type) {
      case 'enterCsi':
        this.enterCsiEntry()
        return
      case 'enterOsc':
        this.enterOscString()
        return
      case 'enterDcs':
        this.enterDcsEntry()
        return
      case 'enterSosPmApc':
        this.enterSosPmApc(action.kind)
        return
      case 'dispatchEscape':
        this.dispatchEscFinal(action.final, sink)
        return
      case 'execute':
        this.emitExecute(byte, sink)
        return
      case 'ignore':
        return
    }
  }

  private handleC1Escaped(byte: number, sink: ParserEventSink): void {
    const final = byte - 0x40
    if (final < 0x40 || final > 0x5f) {
      this.flushPrint(sink)
      this.emitExecute(byte, sink)
      return
    }

    this.flushPrint(sink)
    this.resetIntermediates()
    this.context.state = ParserState.Escape
    this.dispatchStateByte(ParserState.Escape, final, sink)
  }

  private dispatchEscFinal(final: number, sink: ParserEventSink): void {
    this.resetIntermediates()
    this.context.state = ParserState.Escape
    this.dispatchStateByte(ParserState.Escape, final, sink)
  }

  // ECMA-48 §8.3.92 (OSC): capture string data until BEL or ST terminator.
  private handleOscString(byte: number, sink: ParserEventSink): void {
    if (this.context.oscEscPending) {
      this.context.oscEscPending = false
      if (byte === 0x5c) {
        this.emitOscDispatch(sink)
        return
      }
      this.context.oscBuffer.push(ESC)
      this.handleOscString(byte, sink)
      return
    }

    if (byte === ESC) {
      this.context.oscEscPending = true
      return
    }

    if (byte === CAN || byte === SUB) {
      this.cancelOsc()
      return
    }

    if (byte === BEL || byte === ST_8BIT) {
      this.emitOscDispatch(sink)
      return
    }

    if (this.context.oscBuffer.length >= this.maxStringLength) {
      this.cancelOsc()
      return
    }

    this.context.oscBuffer.push(byte)
  }

  private handleSosPmApcString(byte: number, sink: ParserEventSink): void {
    if (this.context.sosPmApcEscPending) {
      this.context.sosPmApcEscPending = false
      if (byte === 0x5c) {
        this.emitSosPmApcDispatch(sink)
        return
      }
      this.context.sosPmApcBuffer.push(ESC)
      this.handleSosPmApcString(byte, sink)
      return
    }

    if (byte === ESC) {
      this.context.sosPmApcEscPending = true
      return
    }

    if (byte === CAN || byte === SUB) {
      this.cancelSosPmApc()
      return
    }

    if (byte === BEL || byte === ST_8BIT) {
      this.emitSosPmApcDispatch(sink)
      return
    }

    if (this.context.sosPmApcBuffer.length >= this.maxStringLength) {
      this.cancelSosPmApc()
      return
    }

    this.context.sosPmApcBuffer.push(byte)
  }

  private enterDcsIgnore(): void {
    if (this.context.state === ParserState.DcsIgnore) {
      return
    }

    this.resetParamContext()
    this.context.state = ParserState.DcsIgnore
  }

  // Annex B note: invalid CSI routes to ignore state until final/CAN/SUB.
  private enterCsiIgnore(): void {
    this.resetParamContext()
    this.context.state = ParserState.CsiIgnore
  }

  // ECMA-48 §8.3 (CAN/SUB): cancel the current control sequence.
  private cancelCsi(): void {
    this.resetCsiContext()
    this.context.state = ParserState.Ground
  }

  private cancelDcs(): void {
    this.resetParamContext()
    this.context.dcsBuffer = []
    this.context.dcsEscPending = false
    this.context.state = ParserState.Ground
  }

  private cancelOsc(): void {
    this.context.oscBuffer = []
    this.context.oscEscPending = false
    this.context.state = ParserState.Ground
  }

  private cancelSosPmApc(): void {
    this.context.sosPmApcBuffer = []
    this.context.sosPmApcEscPending = false
    this.context.sosPmApcKind = null
    this.context.state = ParserState.Ground
  }

  // Annex B CSI dispatch: emit event unless validation failed.
  private finalizeCsi(finalByte: number, sink: ParserEventSink): void {
    const params = this.resolveParams()

    if (params.length > MAX_CSI_PARAMS) {
      this.cancelCsi()
      return
    }

    const event: ParserEvent = {
      type: ParserEventType.CsiDispatch,
      finalByte,
      params,
      intermediates: [...this.context.intermediates],
      prefix: this.context.prefix,
    }

    this.resetCsiContext()
    this.context.state = ParserState.Ground
    sink.onEvent(event)
  }

  private finalizeDcs(finalByte: number, sink: ParserEventSink): void {
    const params = this.resolveParams()
    if (params.length > MAX_CSI_PARAMS) {
      this.cancelDcs()
      return
    }

    const event: ParserEvent = {
      type: ParserEventType.DcsHook,
      finalByte,
      params,
      intermediates: [...this.context.intermediates],
    }

    this.resetParamContext()
    this.context.dcsBuffer = []
    this.context.dcsEscPending = false
    this.context.state = ParserState.DcsPassthrough
    sink.onEvent(event)
  }

  private pushCurrentParam(): void {
    if (this.context.params.length >= MAX_CSI_PARAMS) {
      this.enterParamIgnore()
      return
    }

    this.context.params.push(this.context.currentParam ?? 0)
    this.context.currentParam = null
  }

  private handleCsiParamDigit(byte: number): void {
    const digit = byte - 0x30
    this.context.currentParam = (this.context.currentParam ?? 0) * 10 + digit

    if ((this.context.currentParam ?? 0) > MAX_CSI_PARAM_VALUE) {
      this.enterCsiIgnore()
    }
  }

  private handleDcsParamDigit(byte: number): void {
    const digit = byte - DIGIT_START
    this.context.currentParam = (this.context.currentParam ?? 0) * 10 + digit

    if ((this.context.currentParam ?? 0) > MAX_CSI_PARAM_VALUE) {
      this.enterDcsIgnore()
    }
  }

  private processDcsParamByte(byte: number, sink?: ParserEventSink): void {
    if (byte >= DIGIT_START && byte <= DIGIT_END) {
      this.handleDcsParamDigit(byte)
      return
    }

    if (byte === COLON || byte === SEMICOLON) {
      this.pushCurrentParam()
      return
    }

    if (byte >= FINAL_START && byte <= FINAL_END) {
      if (!sink) {
        return
      }
      this.finalizeDcs(byte, sink)
      return
    }

    this.enterDcsIgnore()
  }

  private enterParamIgnore(): void {
    if (
      this.context.state === ParserState.DcsParam ||
      this.context.state === ParserState.DcsIntermediate
    ) {
      this.enterDcsIgnore()
    } else {
      this.enterCsiIgnore()
    }
  }

  private resolveParams(): number[] {
    const params = [...this.context.params]
    if (this.context.currentParam !== null) {
      params.push(this.context.currentParam)
    } else if (params.length === 0) {
      params.push(0)
    }
    return params
  }

  private resetCsiContext(): void {
    this.resetParamContext()
  }

  private resetParamContext(): void {
    this.context.params = []
    this.context.currentParam = null
    this.context.prefix = null
    this.context.intermediates = []
  }

  private enterCsiEntry(): void {
    this.resetCsiContext()
    this.context.state = ParserState.CsiEntry
  }

  private enterOscString(): void {
    this.context.oscBuffer = []
    this.context.oscEscPending = false
    this.context.state = ParserState.OscString
  }

  private enterSosPmApc(kind: SosPmApcKind): void {
    this.context.sosPmApcBuffer = []
    this.context.sosPmApcEscPending = false
    this.context.sosPmApcKind = kind
    this.context.state = ParserState.SosPmApcString
  }

  private enterDcsEntry(): void {
    this.resetParamContext()
    this.context.dcsBuffer = []
    this.context.dcsEscPending = false
    this.context.state = ParserState.DcsEntry
  }

  // ECMA-48 §8.3.115 (DCS): pass data until final ST.
  private handleDcsPassthrough(byte: number, sink: ParserEventSink): void {
    if (this.context.dcsEscPending) {
      this.context.dcsEscPending = false
      if (byte === 0x5c) {
        this.flushDcsBuffer(sink)
        this.emitDcsUnhook(sink)
        return
      }
      this.appendDcsByte(ESC, sink)
      this.handleDcsPassthrough(byte, sink)
      return
    }

    if (byte === ESC) {
      this.context.dcsEscPending = true
      return
    }

    if (byte === CAN || byte === SUB) {
      this.flushDcsBuffer(sink)
      this.cancelDcs()
      return
    }

    if (byte === ST_8BIT || byte === BEL) {
      this.flushDcsBuffer(sink)
      this.emitDcsUnhook(sink)
      return
    }

    this.appendDcsByte(byte, sink)
  }

  private emitEscDispatch(finalByte: number, sink: ParserEventSink): void {
    const event: ParserEvent = {
      type: ParserEventType.EscDispatch,
      finalByte,
      intermediates: [...this.context.intermediates],
    }
    this.resetIntermediates()
    sink.onEvent(event)
  }

  private resetIntermediates(): void {
    this.context.intermediates = []
  }

  private emitExecute(codePoint: number, sink: ParserEventSink): void {
    const event: ParserEvent = {
      type: ParserEventType.Execute,
      codePoint,
    }
    sink.onEvent(event)
  }

  private emitOscDispatch(sink: ParserEventSink): void {
    const event: ParserEvent = {
      type: ParserEventType.OscDispatch,
      data: Uint8Array.from(this.context.oscBuffer),
    }
    this.cancelOsc()
    sink.onEvent(event)
  }

  private emitSosPmApcDispatch(sink: ParserEventSink): void {
    const kind = this.context.sosPmApcKind
    if (kind === null) {
      this.cancelSosPmApc()
      return
    }

    const event: ParserEvent = {
      type: ParserEventType.SosPmApcDispatch,
      kind,
      data: Uint8Array.from(this.context.sosPmApcBuffer),
    }
    this.cancelSosPmApc()
    sink.onEvent(event)
  }

  private appendDcsByte(byte: number, sink: ParserEventSink): void {
    if (this.context.dcsBuffer.length >= this.maxStringLength) {
      this.cancelDcs()
      return
    }

    if (this.context.dcsBuffer.length === DCS_CHUNK_SIZE) {
      this.flushDcsBuffer(sink)
    }

    this.context.dcsBuffer.push(byte)
  }

  private flushDcsBuffer(sink: ParserEventSink): void {
    if (this.context.dcsBuffer.length === 0) {
      return
    }

    const event: ParserEvent = {
      type: ParserEventType.DcsPut,
      data: Uint8Array.from(this.context.dcsBuffer),
    }
    this.context.dcsBuffer = []
    sink.onEvent(event)
  }

  private emitDcsUnhook(sink: ParserEventSink): void {
    const event: ParserEvent = {
      type: ParserEventType.DcsUnhook,
    }
    this.cancelDcs()
    sink.onEvent(event)
  }

  private flushPrint(sink: ParserEventSink): void {
    if (this.printBuffer.length === 0) {
      return
    }
    const data = Uint8Array.from(this.printBuffer)
    this.printBuffer = []
    const event: ParserEvent = {
      type: ParserEventType.Print,
      data,
    }
    sink.onEvent(event)
  }
}

export const createParser = (options: ParserOptions = {}): Parser =>
  new ParserImpl(options)
