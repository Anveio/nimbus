import { createInitialContext } from './internal/context'
import {
  type Parser,
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  ParserState,
  type ParserOptions,
  type C1HandlingMode,
  type SosPmApcKind,
} from './types'
import { getSpecC1Action } from './internal/c1-table'

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
const DCS_THRESHOLD = 1024
const MAX_CSI_PARAMS = 16
const MAX_CSI_INTERMEDIATES = 4 
const MAX_CSI_PARAM_VALUE = 65535
const DEFAULT_C1_MODE: C1HandlingMode = 'spec'

class ParserImpl implements Parser {
  private context = createInitialContext()
  private readonly encoder = new TextEncoder()
  private printBuffer: number[] = []
  private readonly c1Mode: C1HandlingMode

  constructor(options: ParserOptions = {}) {
    this.c1Mode = options.c1Handling ?? DEFAULT_C1_MODE
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
    switch (this.context.state) {
      case ParserState.Ground:
        this.handleGround(byte, sink)
        break
      case ParserState.Escape:
        this.handleEscape(byte, sink)
        break
      case ParserState.EscapeIntermediate:
        this.handleEscapeIntermediate(byte, sink)
        break
      case ParserState.CsiEntry:
        this.handleCsiEntry(byte, sink)
        break
      case ParserState.CsiParam:
        this.handleCsiParam(byte, sink)
        break
      case ParserState.CsiIntermediate:
        this.handleCsiIntermediate(byte, sink)
        break
      case ParserState.CsiIgnore:
        this.handleCsiIgnore(byte)
        break
      case ParserState.OscString:
        this.handleOscString(byte, sink)
        break
      case ParserState.DcsEntry:
        this.handleDcsEntry(byte, sink)
        break
      case ParserState.DcsParam:
        this.handleDcsParam(byte, sink)
        break
      case ParserState.DcsIntermediate:
        this.handleDcsIntermediate(byte, sink)
        break
      case ParserState.DcsIgnore:
        this.handleDcsIgnore(byte)
        break
      case ParserState.DcsPassthrough:
        this.handleDcsPassthrough(byte, sink)
        break
      case ParserState.SosPmApcString:
        this.handleSosPmApcString(byte, sink)
        break
    }
  }

  // ECMA-48 Annex B (ground state): emit printable characters, execute C0/C1,
  // or transition to escape/CSI introducers.
  private handleGround(byte: number, sink: ParserEventSink): void {
    if (byte === ESC) {
      this.flushPrint(sink)
      this.context.state = ParserState.Escape
      this.resetIntermediates()
      return
    }

    if (byte <= 0x1f || byte === 0x7f) {
      this.flushPrint(sink)
      this.emitExecute(byte, sink)
      return
    }

    if (byte >= 0x20 && byte <= 0x7e) {
      this.printBuffer.push(byte)
      return
    }

    if (byte >= 0x80 && byte <= 0x9f) {
      this.handleC1(byte, sink)
      return
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
    this.handleEscape(final, sink)
  }

  private dispatchEscFinal(final: number, sink: ParserEventSink): void {
    this.resetIntermediates()
    this.context.state = ParserState.Escape
    this.handleEscape(final, sink)
  }

  // Annex B escape state: collect intermediates or dispatch final byte.
  private handleEscape(byte: number, sink: ParserEventSink): void {
    if (byte === 0x5b) {
      this.enterCsiEntry()
      return
    }

    if (byte === 0x5d) {
      this.enterOscString()
      return
    }

    if (byte === 0x50) {
      this.enterDcsEntry()
      return
    }

    if (byte === 0x58) {
      this.enterSosPmApc('SOS')
      return
    }

    if (byte === 0x5e) {
      this.enterSosPmApc('PM')
      return
    }

    if (byte === 0x5f) {
      this.enterSosPmApc('APC')
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.EscapeIntermediate
      return
    }

    if (byte >= 0x30 && byte <= 0x7e) {
      this.emitEscDispatch(byte, sink)
      this.context.state = ParserState.Ground
      return
    }

    // Unknown byte, drop back to ground.
    this.context.state = ParserState.Ground
  }

  // Annex B escape intermediate: accept further 0x20–0x2F bytes before final.
  private handleEscapeIntermediate(byte: number, sink: ParserEventSink): void {
    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      return
    }

    if (byte >= 0x30 && byte <= 0x7e) {
      this.emitEscDispatch(byte, sink)
      this.context.state = ParserState.Ground
      return
    }

    this.context.state = ParserState.Ground
  }

  // Annex B CSI entry: manage private prefixes, parameters, or immediate final.
  private handleCsiEntry(byte: number, sink: ParserEventSink): void {
    if (byte === CAN || byte === SUB) {
      this.cancelCsi()
      return
    }

    if (byte === ESC) {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x3c && byte <= 0x3f) {
      if (this.context.prefix === null) {
        this.context.prefix = byte
      } else {
        this.enterCsiIgnore()
      }
      return
    }

    if (byte >= 0x30 && byte <= 0x3f) {
      this.context.state = ParserState.CsiParam
      this.handleCsiParam(byte, sink)
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterCsiIgnore()
        return
      }

      this.context.intermediates.push(byte)
      this.context.state = ParserState.CsiIntermediate
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeCsi(byte, sink)
      return
    }

    this.cancelCsi()
  }

  // Annex B CSI param: gather decimal params and guard against overflow.
  private handleCsiParam(byte: number, sink: ParserEventSink): void {
    if (byte === CAN || byte === SUB) {
      this.cancelCsi()
      return
    }

    if (byte === ESC) {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x30 && byte <= 0x39) {
      const digit = byte - 0x30
      this.context.currentParam = (this.context.currentParam ?? 0) * 10 + digit

      if ((this.context.currentParam ?? 0) > MAX_CSI_PARAM_VALUE) {
        this.enterCsiIgnore()
      }
      return
    }

    if (byte === 0x3b || byte === 0x3a) {
      this.pushCurrentParam()
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterCsiIgnore()
        return
      }

      this.context.intermediates.push(byte)
      this.context.state = ParserState.CsiIntermediate
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeCsi(byte, sink)
      return
    }

    this.enterCsiIgnore()
  }

  // Annex B CSI intermediate: collect 0x20–0x2F or await final dispatch.
  private handleCsiIntermediate(byte: number, sink: ParserEventSink): void {
    if (byte === CAN || byte === SUB) {
      this.cancelCsi()
      return
    }

    if (byte === ESC) {
      this.resetCsiContext()
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterCsiIgnore()
        return
      }

      this.context.intermediates.push(byte)
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeCsi(byte, sink)
      return
    }

    this.enterCsiIgnore()
  }

  // Annex B CSI ignore: consume bytes until cancellation or termination.
  private handleCsiIgnore(byte: number): void {
    if (byte === CAN || byte === SUB) {
      this.context.state = ParserState.Ground
      return
    }

    if (byte === ESC) {
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.context.state = ParserState.Ground
    }
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

  private handleDcsEntry(byte: number, sink: ParserEventSink): void {
    if (byte === CAN || byte === SUB) {
      this.cancelDcs()
      return
    }

    if (byte === ESC) {
      this.resetParamContext()
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x3c && byte <= 0x3f) {
      if (this.context.prefix === null) {
        this.context.prefix = byte
      } else {
        this.enterDcsIgnore()
      }
      return
    }

    if (byte >= 0x30 && byte <= 0x3f) {
      this.context.state = ParserState.DcsParam
      this.handleDcsParam(byte, sink)
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.DcsIntermediate
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeDcs(byte, sink)
      return
    }

    this.enterDcsIgnore()
  }

  private handleDcsParam(byte: number, sink: ParserEventSink): void {
    if (byte === CAN || byte === SUB) {
      this.cancelDcs()
      return
    }

    if (byte === ESC) {
      this.resetParamContext()
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x30 && byte <= 0x39) {
      const digit = byte - 0x30
      this.context.currentParam = (this.context.currentParam ?? 0) * 10 + digit

      if ((this.context.currentParam ?? 0) > MAX_CSI_PARAM_VALUE) {
        this.enterDcsIgnore()
      }
      return
    }

    if (byte === 0x3b || byte === 0x3a) {
      this.pushCurrentParam()
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.DcsIntermediate
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeDcs(byte, sink)
      return
    }

    this.enterDcsIgnore()
  }

  private handleDcsIntermediate(byte: number, sink: ParserEventSink): void {
    if (byte === CAN || byte === SUB) {
      this.cancelDcs()
      return
    }

    if (byte === ESC) {
      this.resetParamContext()
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      if (this.context.intermediates.length >= MAX_CSI_INTERMEDIATES) {
        this.enterDcsIgnore()
        return
      }

      this.context.intermediates.push(byte)
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeDcs(byte, sink)
      return
    }

    this.enterDcsIgnore()
  }

  private handleDcsIgnore(byte: number): void {
    if (byte === CAN || byte === SUB) {
      this.context.state = ParserState.Ground
      return
    }

    if (byte === ESC) {
      this.context.state = ParserState.Escape
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.context.state = ParserState.Ground
    }
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
    this.context.dcsBuffer.push(byte)
    if (this.context.dcsBuffer.length >= DCS_THRESHOLD) {
      this.flushDcsBuffer(sink)
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
