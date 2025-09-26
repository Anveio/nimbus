import { createInitialContext } from './internal/context'
import {
  type Parser,
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  ParserState,
} from './types'

const ESC = 0x1b
const CSI_8BIT = 0x9b
const CAN = 0x18
const SUB = 0x1a
const MAX_CSI_PARAMS = 16
const MAX_CSI_INTERMEDIATES = 4
const MAX_CSI_PARAM_VALUE = 65535

class ParserImpl implements Parser {
  private context = createInitialContext()
  private readonly encoder = new TextEncoder()
  private printBuffer: number[] = []

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
      case ParserState.DcsEntry:
      case ParserState.DcsParam:
      case ParserState.DcsIntermediate:
      case ParserState.DcsIgnore:
      case ParserState.DcsPassthrough:
      case ParserState.SosPmApcString:
        // Not implemented yet; fall back to ground to avoid lock up.
        this.context.state = ParserState.Ground
        this.handleGround(byte, sink)
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

    if (byte === CSI_8BIT) {
      this.flushPrint(sink)
      this.enterCsiEntry()
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
      // Most C1 controls are not yet handled; treat as execute for now.
      this.flushPrint(sink)
      this.emitExecute(byte, sink)
      return
    }
  }

  // Annex B escape state: collect intermediates or dispatch final byte.
  private handleEscape(byte: number, sink: ParserEventSink): void {
    if (byte === 0x5b) {
      this.enterCsiEntry()
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

  // Annex B note: invalid CSI routes to ignore state until final/CAN/SUB.
  private enterCsiIgnore(): void {
    if (this.context.state === ParserState.CsiIgnore) {
      return
    }

    this.resetCsiContext()
    this.context.state = ParserState.CsiIgnore
  }

  // ECMA-48 §8.3 (CAN/SUB): cancel the current control sequence.
  private cancelCsi(): void {
    this.resetCsiContext()
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

  private pushCurrentParam(): void {
    if (this.context.params.length >= MAX_CSI_PARAMS) {
      this.enterCsiIgnore()
      return
    }

    this.context.params.push(this.context.currentParam ?? 0)
    this.context.currentParam = null
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
    this.context.params = []
    this.context.currentParam = null
    this.context.prefix = null
    this.context.intermediates = []
  }

  private enterCsiEntry(): void {
    this.resetCsiContext()
    this.context.state = ParserState.CsiEntry
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

export const createParser = (): Parser => new ParserImpl()
