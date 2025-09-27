import { getSpecC1Action } from './internal/c1-table'
import { createInitialContext } from './internal/context'
import {
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

  private buildDispatchTable(): Record<
    ParserState,
    ReadonlyArray<ByteHandler>
  > {
    const createRow = (): ByteHandler[] =>
      new Array<ByteHandler>(BYTE_TABLE_SIZE).fill(this.noopHandler)

    const table: Record<ParserState, ByteHandler[]> = {
      [ParserState.Ground]: createRow(),
      [ParserState.Escape]: createRow(),
      [ParserState.EscapeIntermediate]: createRow(),
      [ParserState.CsiEntry]: createRow(),
      [ParserState.CsiParam]: createRow(),
      [ParserState.CsiIntermediate]: createRow(),
      [ParserState.CsiIgnore]: createRow(),
      [ParserState.OscString]: createRow(),
      [ParserState.DcsEntry]: createRow(),
      [ParserState.DcsParam]: createRow(),
      [ParserState.DcsIntermediate]: createRow(),
      [ParserState.DcsIgnore]: createRow(),
      [ParserState.DcsPassthrough]: createRow(),
      [ParserState.SosPmApcString]: createRow(),
    }

    this.configureGroundRow(table[ParserState.Ground])
    this.configureEscapeRow(table[ParserState.Escape])
    this.configureEscapeIntermediateRow(table[ParserState.EscapeIntermediate])
    this.configureCsiEntryRow(table[ParserState.CsiEntry])
    this.configureCsiParamRow(table[ParserState.CsiParam])
    this.configureCsiIntermediateRow(table[ParserState.CsiIntermediate])
    this.configureCsiIgnoreRow(table[ParserState.CsiIgnore])
    this.configureOscRow(table[ParserState.OscString])
    this.configureDcsEntryRow(table[ParserState.DcsEntry])
    this.configureDcsParamRow(table[ParserState.DcsParam])
    this.configureDcsIntermediateRow(table[ParserState.DcsIntermediate])
    this.configureDcsIgnoreRow(table[ParserState.DcsIgnore])
    this.configureDcsPassthroughRow(table[ParserState.DcsPassthrough])
    this.configureSosPmApcRow(table[ParserState.SosPmApcString])

    return table
  }

  private configureGroundRow(row: ByteHandler[]): void {
    const printable: ByteHandler = (byte) => {
      this.printBuffer.push(byte)
    }
    this.assignRange(row, INTERMEDIATE_START, FINAL_END, printable)

    const executeControl: ByteHandler = (byte, sink) => {
      this.flushPrint(sink)
      this.emitExecute(byte, sink)
    }
    this.assignRange(row, 0x00, INTERMEDIATE_START - 1, executeControl)
    row[DELETE] = executeControl

    const enterEscape: ByteHandler = (_byte, sink) => {
      this.flushPrint(sink)
      this.context.state = ParserState.Escape
      this.resetIntermediates()
    }
    row[ESC] = enterEscape

    if (this.acceptEightBitControls) {
      const c1Handler: ByteHandler = (byte, sink) => {
        this.handleC1(byte, sink)
      }
      this.assignRange(row, 0x80, 0x9f, c1Handler)
    }
  }

  private configureEscapeRow(row: ByteHandler[]): void {
    const dropToGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }
    row.fill(dropToGround)

    this.assignByte(row, 0x5b, () => this.enterCsiEntry())
    this.assignByte(row, 0x5d, () => this.enterOscString())
    this.assignByte(row, 0x50, () => this.enterDcsEntry())
    this.assignByte(row, 0x58, () => this.enterSosPmApc('SOS'))
    this.assignByte(row, 0x5e, () => this.enterSosPmApc('PM'))
    this.assignByte(row, 0x5f, () => this.enterSosPmApc('APC'))

    const collectIntermediate: ByteHandler = (byte) => {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.EscapeIntermediate
    }
    this.assignRange(
      row,
      INTERMEDIATE_START,
      INTERMEDIATE_END,
      collectIntermediate,
    )

    const dispatchEscape: ByteHandler = (byte, sink) => {
      this.emitEscDispatch(byte, sink)
      this.context.state = ParserState.Ground
    }
    this.assignRangeIfMatch(
      row,
      PARAM_START,
      FINAL_END,
      dropToGround,
      dispatchEscape,
    )
  }

  private configureEscapeIntermediateRow(row: ByteHandler[]): void {
    const toGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }
    row.fill(toGround)

    const collect: ByteHandler = (byte) => {
      this.context.intermediates.push(byte)
    }
    this.assignRange(row, INTERMEDIATE_START, INTERMEDIATE_END, collect)

    const dispatch: ByteHandler = (byte, sink) => {
      this.emitEscDispatch(byte, sink)
      this.context.state = ParserState.Ground
    }
    this.assignRange(row, PARAM_START, FINAL_END, dispatch)
  }

  private configureCsiEntryRow(row: ByteHandler[]): void {
    const cancel: ByteHandler = () => {
      this.cancelCsi()
    }
    row.fill(cancel)
    this.assignBytes(row, [CAN, SUB], cancel)

    const setToEscape: ByteHandler = () => {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
    }
    row[ESC] = setToEscape

    const recordPrefix: ByteHandler = (byte) => {
      if (this.context.prefix === null) {
        this.context.prefix = byte
      } else {
        this.enterCsiIgnore()
      }
    }
    this.assignRange(row, 0x3c, 0x3f, recordPrefix)

    const recordDigit: ByteHandler = (byte) => {
      this.handleCsiParamDigit(byte)
    }
    const enterParamWithDigit = this.transitionTo(
      ParserState.CsiParam,
      recordDigit,
    )
    this.assignRange(row, DIGIT_START, DIGIT_END, enterParamWithDigit)

    const pushParam: ByteHandler = () => {
      this.pushCurrentParam()
    }
    const enterParamAndPush = this.transitionTo(ParserState.CsiParam, pushParam)
    this.assignBytes(row, [COLON, SEMICOLON], enterParamAndPush)

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
    this.assignRange(
      row,
      INTERMEDIATE_START,
      INTERMEDIATE_END,
      moveToIntermediate,
    )

    const dispatchFinal: ByteHandler = (byte, sink) => {
      this.finalizeCsi(byte, sink)
    }
    this.assignRange(row, FINAL_START, FINAL_END, dispatchFinal)
  }

  private configureCsiParamRow(row: ByteHandler[]): void {
    const ignore: ByteHandler = () => {
      this.enterCsiIgnore()
    }
    row.fill(ignore)

    const cancel: ByteHandler = () => {
      this.cancelCsi()
    }
    this.assignBytes(row, [CAN, SUB], cancel)

    row[ESC] = () => {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
    }

    const digit: ByteHandler = (byte) => {
      this.handleCsiParamDigit(byte)
    }
    this.assignRange(row, DIGIT_START, DIGIT_END, digit)

    const separator: ByteHandler = () => {
      this.pushCurrentParam()
    }
    this.assignBytes(row, [COLON, SEMICOLON], separator)

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
    this.assignRange(row, INTERMEDIATE_START, INTERMEDIATE_END, toIntermediate)

    const dispatchFinal: ByteHandler = (byte, sink) => {
      this.finalizeCsi(byte, sink)
    }
    this.assignRange(row, FINAL_START, FINAL_END, dispatchFinal)
  }

  private configureCsiIntermediateRow(row: ByteHandler[]): void {
    const ignoreHandler: ByteHandler = () => {
      this.enterCsiIgnore()
    }
    row.fill(ignoreHandler)

    const cancelHandler: ByteHandler = () => {
      this.cancelCsi()
    }
    this.assignBytes(row, [CAN, SUB], cancelHandler)

    row[ESC] = () => {
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
    this.assignRange(row, INTERMEDIATE_START, INTERMEDIATE_END, collectHandler)

    const finalHandler: ByteHandler = (byte, sink) => {
      this.finalizeCsi(byte, sink)
    }
    this.assignRange(row, FINAL_START, FINAL_END, finalHandler)
  }

  private configureCsiIgnoreRow(row: ByteHandler[]): void {
    const stayHandler: ByteHandler = () => {}
    row.fill(stayHandler)

    const toGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }
    this.assignBytes(row, [CAN, SUB], toGround)

    row[ESC] = () => {
      this.context.state = ParserState.Escape
    }

    const terminate: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }
    this.assignRange(row, FINAL_START, FINAL_END, terminate)
  }

  private configureOscRow(row: ByteHandler[]): void {
    const handler: ByteHandler = (byte, sink) => {
      this.handleOscString(byte, sink)
    }
    row.fill(handler)
  }

  private configureDcsEntryRow(row: ByteHandler[]): void {
    const toIgnore: ByteHandler = () => {
      this.enterDcsIgnore()
    }
    row.fill(toIgnore)

    const cancel: ByteHandler = () => {
      this.cancelDcs()
    }
    this.assignBytes(row, [CAN, SUB], cancel)

    row[ESC] = () => {
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
    this.assignRange(row, 0x3c, 0x3f, recordPrefix)

    const enterParam = this.transitionTo(ParserState.DcsParam, (byte, sink) => {
      this.processDcsParamByte(byte, sink)
    })
    this.assignRange(row, PARAM_START, SEMICOLON, enterParam)

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
    this.assignRange(
      row,
      INTERMEDIATE_START,
      INTERMEDIATE_END,
      enterIntermediate,
    )

    const dispatch: ByteHandler = (byte, sink) => {
      this.finalizeDcs(byte, sink)
    }
    this.assignRange(row, FINAL_START, FINAL_END, dispatch)
  }

  private configureDcsParamRow(row: ByteHandler[]): void {
    const toIgnore: ByteHandler = () => {
      this.enterDcsIgnore()
    }
    row.fill(toIgnore)

    const cancel: ByteHandler = () => {
      this.cancelDcs()
    }
    this.assignBytes(row, [CAN, SUB], cancel)

    row[ESC] = () => {
      this.resetParamContext()
      this.context.state = ParserState.Escape
    }

    const digit: ByteHandler = (byte) => {
      this.handleDcsParamDigit(byte)
    }
    this.assignRange(row, DIGIT_START, DIGIT_END, digit)

    const separator: ByteHandler = () => {
      this.pushCurrentParam()
    }
    this.assignBytes(row, [COLON, SEMICOLON], separator)

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
    this.assignRange(row, INTERMEDIATE_START, INTERMEDIATE_END, toIntermediate)

    const dispatch: ByteHandler = (byte, sink) => {
      this.finalizeDcs(byte, sink)
    }
    this.assignRange(row, FINAL_START, FINAL_END, dispatch)
  }

  private configureDcsIntermediateRow(row: ByteHandler[]): void {
    const toIgnore: ByteHandler = () => {
      this.enterDcsIgnore()
    }
    row.fill(toIgnore)

    const cancel: ByteHandler = () => {
      this.cancelDcs()
    }
    this.assignBytes(row, [CAN, SUB], cancel)

    row[ESC] = () => {
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
    this.assignRange(row, INTERMEDIATE_START, INTERMEDIATE_END, collect)

    const dispatch: ByteHandler = (byte, sink) => {
      this.finalizeDcs(byte, sink)
    }
    this.assignRange(row, FINAL_START, FINAL_END, dispatch)
  }

  private configureDcsIgnoreRow(row: ByteHandler[]): void {
    const stay: ByteHandler = () => {}
    row.fill(stay)

    const toGround: ByteHandler = () => {
      this.context.state = ParserState.Ground
    }
    this.assignBytes(row, [CAN, SUB], toGround)

    row[ESC] = () => {
      this.context.state = ParserState.Escape
    }

    this.assignRange(row, FINAL_START, FINAL_END, toGround)
  }

  private configureDcsPassthroughRow(row: ByteHandler[]): void {
    const handler: ByteHandler = (byte, sink) => {
      this.handleDcsPassthrough(byte, sink)
    }
    row.fill(handler)
  }

  private configureSosPmApcRow(row: ByteHandler[]): void {
    const handler: ByteHandler = (byte, sink) => {
      this.handleSosPmApcString(byte, sink)
    }
    row.fill(handler)
  }

  private assignByte(
    row: ByteHandler[],
    code: number,
    handler: ByteHandler,
  ): void {
    row[code] = handler
  }

  private assignBytes(
    row: ByteHandler[],
    codes: ReadonlyArray<number>,
    handler: ByteHandler,
  ): void {
    for (const code of codes) {
      row[code] = handler
    }
  }

  private assignRange(
    row: ByteHandler[],
    start: number,
    end: number,
    handler: ByteHandler,
  ): void {
    for (let code = start; code <= end; code += 1) {
      row[code] = handler
    }
  }

  private assignRangeIfMatch(
    row: ByteHandler[],
    start: number,
    end: number,
    expected: ByteHandler,
    handler: ByteHandler,
  ): void {
    for (let code = start; code <= end; code += 1) {
      if (row[code] === expected) {
        row[code] = handler
      }
    }
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
    const action = getSpecC1Action(byte)
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
