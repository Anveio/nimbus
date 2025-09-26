import { createInitialContext } from './internal/context'
import {
  type Parser,
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  ParserState,
} from './types'

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

  private handleGround(byte: number, sink: ParserEventSink): void {
    if (byte === 0x1b) {
      this.flushPrint(sink)
      this.context.state = ParserState.Escape
      this.resetIntermediates()
      return
    }

    if (byte === 0x9b) {
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

  private handleCsiEntry(byte: number, sink: ParserEventSink): void {
    if (byte >= 0x3c && byte <= 0x3f && this.context.prefix === null) {
      this.context.prefix = byte
      return
    }

    if (byte >= 0x30 && byte <= 0x3f) {
      this.context.state = ParserState.CsiParam
      this.handleCsiParam(byte, sink)
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.CsiIntermediate
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeCsi(byte, sink)
      return
    }

    this.context.state = ParserState.Ground
  }

  private handleCsiParam(byte: number, sink: ParserEventSink): void {
    if (byte >= 0x30 && byte <= 0x39) {
      const digit = byte - 0x30
      this.context.currentParam = (this.context.currentParam ?? 0) * 10 + digit
      return
    }

    if (byte === 0x3b || byte === 0x3a) {
      this.pushCurrentParam()
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      this.context.state = ParserState.CsiIntermediate
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeCsi(byte, sink)
      return
    }

    // On unexpected input, abort CSI and return to ground per spec guidance.
    this.context.state = ParserState.Ground
    this.resetCsiContext()
  }

  private handleCsiIntermediate(byte: number, sink: ParserEventSink): void {
    if (byte >= 0x20 && byte <= 0x2f) {
      this.context.intermediates.push(byte)
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeCsi(byte, sink)
      return
    }

    this.context.state = ParserState.Ground
    this.resetCsiContext()
  }

  private finalizeCsi(finalByte: number, sink: ParserEventSink): void {
    const event: ParserEvent = {
      type: ParserEventType.CsiDispatch,
      finalByte,
      params: this.resolveParams(),
      intermediates: [...this.context.intermediates],
      prefix: this.context.prefix,
    }

    this.resetCsiContext()
    this.context.state = ParserState.Ground
    sink.onEvent(event)
  }

  private pushCurrentParam(): void {
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
