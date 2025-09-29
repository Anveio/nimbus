import { describe, expect, it } from 'vitest'
import { createParser } from '../src/parser'
import {
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
} from '../src/types'

const encoder = new TextEncoder()
const UTF8_REPLACEMENT = [0xef, 0xbf, 0xbd]

class TestSink implements ParserEventSink {
  readonly events: ParserEvent[] = []
  onEvent(event: ParserEvent): void {
    this.events.push(event)
  }
}

describe('ParserImpl UTF-8 handling', () => {
  it('emits multibyte sequences once complete', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('👋', sink)

    const printEvents = sink.events.filter(
      (event) => event.type === ParserEventType.Print,
    )
    expect(printEvents).toHaveLength(1)
    const data = printEvents[0]?.type === ParserEventType.Print
      ? Array.from(printEvents[0].data)
      : []
    expect(data).toEqual(Array.from(encoder.encode('👋')))
  })

  it('buffers multibyte sequences across writes', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0xf0, 0x9f]), sink)
    expect(sink.events).toHaveLength(0)

    parser.write(new Uint8Array([0x92, 0x96]), sink)

    const printEvents = sink.events.filter(
      (event) => event.type === ParserEventType.Print,
    )
    expect(printEvents).toHaveLength(1)
    const data = printEvents[0]?.type === ParserEventType.Print
      ? Array.from(printEvents[0].data)
      : []
    expect(data).toEqual(Array.from(encoder.encode('💖')))
  })

  it('emits replacement when a sequence is interrupted by control bytes', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0xf0, 0x1b, 0x5b, 0x41]), sink)

    expect(sink.events[0]?.type).toBe(ParserEventType.Print)
    if (sink.events[0]?.type === ParserEventType.Print) {
      expect(Array.from(sink.events[0].data)).toEqual(UTF8_REPLACEMENT)
    }

    expect(sink.events[1]?.type).toBe(ParserEventType.CsiDispatch)
    if (sink.events[1]?.type === ParserEventType.CsiDispatch) {
      expect(sink.events[1].finalByte).toBe('A'.charCodeAt(0))
    }
  })

  it('recovers from malformed continuation bytes', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0xe2, 0x28, 0xa1]), sink)

    const printEvents = sink.events.filter(
      (event) => event.type === ParserEventType.Print,
    )
    expect(printEvents).toHaveLength(1)

    if (printEvents[0]?.type === ParserEventType.Print) {
      expect(Array.from(printEvents[0].data)).toEqual([
        ...UTF8_REPLACEMENT,
        '('.charCodeAt(0),
        ...UTF8_REPLACEMENT,
      ])
    }
  })
})
