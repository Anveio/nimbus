import { classifyByte } from './classifier'
import { BYTE_TO_C1_ACTION } from './internal/c1-table'
import { createInitialContext } from './internal/context'
import { resolveParserOptions } from './internal/resolve-options'
import {
  BYTE_LIMITS,
  BYTE_TABLE_SIZE,
  type ByteHandler,
  CONTROL_BYTES,
  createStateRuleSpecs,
  type StateRuleRuntime,
  type StateRuleSpec,
} from './internal/state-rules'
import {
  type C1HandlingMode,
  type Mutable,
  type Parser,
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  type ParserOptions,
  ParserState,
  type ParserStringLimits,
  type SosPmApcKind,
} from './types'

const ST_8BIT = 0x9c
const MAX_CSI_PARAMS = 16
const MAX_CSI_INTERMEDIATES = 4
const MAX_CSI_PARAM_VALUE = 65535
const DEFAULT_C1_MODE: C1HandlingMode = 'spec'
const DEFAULT_STRING_LIMITS = {
  osc: 4096,
  dcs: 4096,
  sosPmApc: 4096,
} as const

const DCS_CHUNK_SIZE = 1024
const UTF8_REPLACEMENT_BYTES = [0xef, 0xbf, 0xbd] as const

const { ESC, CAN, SUB, BEL } = CONTROL_BYTES
const { DIGIT_START, DIGIT_END, FINAL_START, FINAL_END, COLON, SEMICOLON } =
  BYTE_LIMITS

class ParserImpl implements Parser {
  private context = createInitialContext()
  private readonly encoder = new TextEncoder()
  private printBuffer: number[] = []
  private readonly c1Mode: C1HandlingMode
  private readonly stringLimits: {
    readonly osc: number
    readonly dcs: number
    readonly sosPmApc: number
  }
  private readonly acceptEightBitControls: boolean
  private readonly dispatchTable: Record<
    ParserState,
    ReadonlyArray<ByteHandler>
  >
  private readonly noopHandler: ByteHandler = () => {}

  constructor(options: ParserOptions = {}) {
    this.c1Mode = options.c1Handling ?? DEFAULT_C1_MODE
    this.acceptEightBitControls = options.acceptEightBitControls ?? true
    this.stringLimits = this.resolveStringLimits(options)
    this.dispatchTable = this.buildDispatchTable()
  }

  private resolveStringLimits(options: ParserOptions): ParserStringLimits {
    const sanitized: Mutable<ParserStringLimits> = { ...DEFAULT_STRING_LIMITS }

    const apply = (key: keyof ParserStringLimits, value?: number): void => {
      if (value && value > 0) {
        sanitized[key] = value
      }
    }

    apply('osc', options.maxStringLength)
    apply('dcs', options.maxStringLength)
    apply('sosPmApc', options.maxStringLength)

    if (options.stringLimits) {
      apply('osc', options.stringLimits.osc)
      apply('dcs', options.stringLimits.dcs)
      apply('sosPmApc', options.stringLimits.sosPmApc)
    }

    return sanitized
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

    this.flushPrint(sink, { finalizePending: false })
  }

  reset(): void {
    this.context = createInitialContext()
    this.printBuffer = []
  }

  private processByte(byte: number, sink: ParserEventSink): void {
    if (this.context.utf8ExpectedContinuation > 0) {
      if (isUtf8ContinuationByte(byte)) {
        this.enqueuePrintable(byte)
        return
      }

      this.finalizePendingUtf8Sequence()
    }

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

  private buildRowFromSpec(spec: StateRuleSpec): ByteHandler[] {
    const row = new Array<ByteHandler>(BYTE_TABLE_SIZE)
    for (let code = 0; code < BYTE_TABLE_SIZE; code += 1) {
      const flags = classifyByte(code)
      let handler = spec.fallback
      for (const rule of spec.rules) {
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
    const runtime = this.createStateRuntime()
    const specs = createStateRuleSpecs(runtime)
    const table: Partial<Record<ParserState, ReadonlyArray<ByteHandler>>> = {}
    for (const state of Object.values(ParserState)) {
      const spec = specs[state]
      table[state] = this.buildRowFromSpec(spec)
    }
    return table as Record<ParserState, ReadonlyArray<ByteHandler>>
  }

  private createStateRuntime(): StateRuleRuntime {
    return {
      acceptEightBitControls: this.acceptEightBitControls,
      maxIntermediateCount: MAX_CSI_INTERMEDIATES,
      noop: this.noopHandler,
      pushPrint: (byte) => {
        this.enqueuePrintable(byte)
      },
      flushPrint: (sink) => {
        this.flushPrint(sink)
      },
      emitExecute: (byte, sink) => {
        this.emitExecute(byte, sink)
      },
      handleC1: (byte, sink) => {
        this.handleC1(byte, sink)
      },
      setState: (state) => {
        this.context.state = state
      },
      resetIntermediates: () => {
        this.resetIntermediates()
      },
      addIntermediate: (byte) => {
        this.context.intermediates.push(byte)
      },
      getIntermediateCount: () => this.context.intermediates.length,
      getPrefix: () => this.context.prefix,
      setPrefix: (value) => {
        this.context.prefix = value
      },
      enterCsiEntry: () => this.enterCsiEntry(),
      enterOscString: () => this.enterOscString(),
      enterDcsEntry: () => this.enterDcsEntry(),
      enterSosPmApc: (kind) => this.enterSosPmApc(kind),
      emitEscDispatch: (byte, sink) => this.emitEscDispatch(byte, sink),
      enterCsiIgnore: () => this.enterCsiIgnore(),
      finalizeCsi: (byte, sink) => this.finalizeCsi(byte, sink),
      cancelCsi: () => this.cancelCsi(),
      resetCsiContext: () => this.resetCsiContext(),
      handleCsiParamDigit: (byte) => this.handleCsiParamDigit(byte),
      pushCurrentParam: () => this.pushCurrentParam(),
      enterDcsIgnore: () => this.enterDcsIgnore(),
      cancelDcs: () => this.cancelDcs(),
      resetParamContext: () => this.resetParamContext(),
      finalizeDcs: (byte, sink) => this.finalizeDcs(byte, sink),
      handleDcsParamDigit: (byte) => this.handleDcsParamDigit(byte),
      processDcsParamByte: (byte, sink) => this.processDcsParamByte(byte, sink),
      handleDcsPassthrough: (byte, sink) =>
        this.handleDcsPassthrough(byte, sink),
      handleOscByte: (byte, sink) => this.handleOscString(byte, sink),
      handleSosPmApcByte: (byte, sink) => this.handleSosPmApcString(byte, sink),
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

    if (this.context.oscBuffer.length >= this.stringLimits.osc) {
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

    if (this.context.sosPmApcBuffer.length >= this.stringLimits.sosPmApc) {
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

  private enterDcsOverflow(sink: ParserEventSink): void {
    if (this.context.state === ParserState.DcsIgnore) {
      return
    }

    this.flushDcsBuffer(sink)
    this.context.dcsBuffer = []
    this.context.dcsEscPending = false
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
    this.context.dcsByteCount = 0
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
    this.context.dcsByteCount = 0
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
    this.context.dcsByteCount = 0
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
    if (this.context.dcsByteCount >= this.stringLimits.dcs) {
      this.enterDcsOverflow(sink)
      return
    }

    if (this.context.dcsBuffer.length === DCS_CHUNK_SIZE) {
      this.flushDcsBuffer(sink)
    }

    this.context.dcsBuffer.push(byte)
    this.context.dcsByteCount += 1

    if (this.context.dcsByteCount >= this.stringLimits.dcs) {
      this.enterDcsOverflow(sink)
    }
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

  private enqueuePrintable(byte: number): void {
    let current = byte

    // Loop so we can reprocess the same byte after repairing an incomplete
    // sequence (e.g. when a continuation byte was missing).
    // biome-ignore lint/suspicious/noConstantCondition:
    while (true) {
      if (this.context.utf8ExpectedContinuation > 0) {
        if (isUtf8ContinuationByte(current)) {
          this.context.utf8Pending.push(current)
          this.context.utf8ExpectedContinuation -= 1
          if (this.context.utf8ExpectedContinuation === 0) {
            this.commitPendingUtf8()
          }
          return
        }

        this.appendReplacementCharacter()
        this.resetUtf8Tracking()
        continue
      }

      if (isUtf8ContinuationByte(current)) {
        this.appendReplacementCharacter()
        return
      }

      const required = getUtf8ContinuationCount(current)
      if (required > 0) {
        this.context.utf8Pending = [current]
        this.context.utf8ExpectedContinuation = required
        return
      }

      if (current >= 0x80) {
        this.appendReplacementCharacter()
        return
      }

      this.printBuffer.push(current)
      return
    }
  }

  private commitPendingUtf8(): void {
    if (this.context.utf8Pending.length === 0) {
      return
    }
    this.printBuffer.push(...this.context.utf8Pending)
    this.resetUtf8Tracking()
  }

  private appendReplacementCharacter(): void {
    this.printBuffer.push(...UTF8_REPLACEMENT_BYTES)
  }

  private finalizePendingUtf8Sequence(): void {
    if (this.context.utf8ExpectedContinuation > 0) {
      this.appendReplacementCharacter()
    }
    this.resetUtf8Tracking()
  }

  private resetUtf8Tracking(): void {
    this.context.utf8ExpectedContinuation = 0
    this.context.utf8Pending = []
  }

  private flushPrint(
    sink: ParserEventSink,
    options: { finalizePending?: boolean } = {},
  ): void {
    const { finalizePending = true } = options
    if (finalizePending) {
      this.finalizePendingUtf8Sequence()
    }
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
  new ParserImpl(resolveParserOptions(options))
const getUtf8ContinuationCount = (byte: number): number => {
  if (byte >= 0xf0 && byte <= 0xf4) {
    return 3
  }
  if (byte >= 0xe0 && byte <= 0xef) {
    return 2
  }
  if (byte >= 0xc2 && byte <= 0xdf) {
    return 1
  }
  return 0
}

const isUtf8ContinuationByte = (byte: number): boolean =>
  (byte & 0b11000000) === 0b10000000
