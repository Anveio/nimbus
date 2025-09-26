import { describe, expect, it } from 'vitest'
import { createParser } from '../src/parser'
import {
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  ParserState,
} from '../src/types'

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

class TestSink implements ParserEventSink {
  readonly events: ParserEvent[] = []
  onEvent(event: ParserEvent): void {
    this.events.push(event)
  }
}

describe('ParserImpl basic behaviour', () => {
  it('emits print events for printable runs', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('hello', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected event to be defined')
    expect(event.type).toBe(ParserEventType.Print)
    invariant(event.type === ParserEventType.Print, 'expected print event')
    expect(Array.from(event.data)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f])
  })

  it('emits execute events for C0 controls', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u0007', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected event to be defined')
    expect(event.type).toBe(ParserEventType.Execute)
    invariant(event.type === ParserEventType.Execute, 'expected execute event')
    expect(event.codePoint).toBe(0x07)
  })

  it('transitions to escape state after ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b', sink)

    expect(parser.state).toBe(ParserState.Escape)
  })

  it('dispatches ESC final bytes', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b7', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected event to be defined')
    expect(event.type).toBe(ParserEventType.EscDispatch)
    invariant(
      event.type === ParserEventType.EscDispatch,
      'expected ESC dispatch event',
    )
    expect(event.finalByte).toBe('7'.charCodeAt(0))
    expect(event.intermediates).toEqual([])
  })

  it('collects escape intermediates', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b(0', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected event to be defined')
    expect(event.type).toBe(ParserEventType.EscDispatch)
    invariant(
      event.type === ParserEventType.EscDispatch,
      'expected ESC dispatch event',
    )
    expect(event.intermediates).toEqual(['('.charCodeAt(0)])
    expect(event.finalByte).toBe('0'.charCodeAt(0))
  })

  it('parses simple CSI sequences', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b[31m', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected event to be defined')
    expect(event.type).toBe(ParserEventType.CsiDispatch)
    invariant(
      event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch event',
    )
    expect(event.finalByte).toBe('m'.charCodeAt(0))
    expect(event.params).toEqual([31])
    expect(event.intermediates).toEqual([])
    expect(event.prefix).toBeNull()
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('supports C1 CSI introducer', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9b, 0x41]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected event to be defined')
    expect(event.type).toBe(ParserEventType.CsiDispatch)
    invariant(
      event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch event',
    )
    expect(event.finalByte).toBe('A'.charCodeAt(0))
    expect(event.params).toEqual([0])
  })

  it('ignores CSI sequences that exceed parameter count', () => {
    const parser = createParser()
    const sink = new TestSink()

    const params = Array.from({ length: 17 }, () => '1').join(';')
    parser.write(`\u001b[${params}m`, sink)

    expect(sink.events).toHaveLength(0)
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('ignores CSI sequences with oversized parameter values', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b[999999m', sink)

    expect(sink.events).toHaveLength(0)
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('cancels CSI on CAN control', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b[12\u0018A', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event, 'expected print event')
    expect(event.type).toBe(ParserEventType.Print)
    invariant(event.type === ParserEventType.Print, 'expected print event')
    expect(Array.from(event.data)).toEqual(['A'.charCodeAt(0)])
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('enters CSI ignore with repeated private prefixes', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b[?=1m', sink)

    expect(sink.events).toHaveLength(0)
    expect(parser.state).toBe(ParserState.Ground)
  })
})
