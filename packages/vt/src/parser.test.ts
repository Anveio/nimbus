import { describe, expect, it } from 'vitest'
import { createParser } from './parser'
import {
  type ParserEvent,
  type ParserEventSink,
  ParserEventType,
  ParserState,
} from './types'

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
  it('defaults to spec C1 handling', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9d, 0x32, 0x3b, 0x41, 0x07]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.OscDispatch,
      'expected OSC dispatch',
    )
  })

  it('allows escaped C1 handling', () => {
    const parser = createParser({ c1Handling: 'escaped' })
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9b, 0x41]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch',
    )
    expect(event.finalByte).toBe('A'.charCodeAt(0))
  })

  it('allows execute C1 handling', () => {
    const parser = createParser({ c1Handling: 'execute' })
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9d]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.Execute,
      'expected execute event',
    )
    expect(event.codePoint).toBe(0x9d)
  })

  it('allows ignoring C1 controls', () => {
    const parser = createParser({ c1Handling: 'ignore' })
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9d]), sink)

    expect(sink.events).toHaveLength(0)
  })

  it('maps C1 IND to ESC D in spec mode', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x84]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'expected ESC dispatch',
    )
    expect(event.finalByte).toBe('D'.charCodeAt(0))
  })

  it('maps C1 HTS to ESC H in spec mode', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x88]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'expected ESC dispatch',
    )
    expect(event.finalByte).toBe('H'.charCodeAt(0))
  })

  it('maps C1 RI to ESC M in spec mode', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x8d]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'expected ESC dispatch',
    )
    expect(event.finalByte).toBe('M'.charCodeAt(0))
  })

  it('maps C1 SS2/SS3 to ESC N/O in spec mode', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x8e, 0x8f]), sink)

    expect(sink.events).toHaveLength(2)
    const first = sink.events[0]
    const second = sink.events[1]
    invariant(
      first && first.type === ParserEventType.EscDispatch,
      'expected first ESC dispatch',
    )
    expect(first.finalByte).toBe('N'.charCodeAt(0))
    invariant(
      second && second.type === ParserEventType.EscDispatch,
      'expected second ESC dispatch',
    )
    expect(second.finalByte).toBe('O'.charCodeAt(0))
  })

  it('maps VT220 C1 controls to their ESC aliases in spec mode', () => {
    const cases: Array<{ input: number; final: string }> = [
      { input: 0x86, final: 'F' },
      { input: 0x87, final: 'G' },
      { input: 0x89, final: 'I' },
      { input: 0x8a, final: 'J' },
      { input: 0x8b, final: 'K' },
      { input: 0x8c, final: 'L' },
      { input: 0x91, final: 'Q' },
      { input: 0x92, final: 'R' },
      { input: 0x93, final: 'S' },
      { input: 0x94, final: 'T' },
      { input: 0x95, final: 'U' },
      { input: 0x96, final: 'V' },
      { input: 0x97, final: 'W' },
    ]

    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array(cases.map((c) => c.input)), sink)

    expect(sink.events).toHaveLength(cases.length)
    cases.forEach((testCase, index) => {
      const event = sink.events[index]
      invariant(
        event && event.type === ParserEventType.EscDispatch,
        'expected ESC dispatch',
      )
      expect(event.finalByte).toBe(testCase.final.charCodeAt(0))
    })
  })

  it('parses mixed separator SGR sequences', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b[;4:3;38;2;175;175;215;58:2::190:80:70m', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch',
    )
    expect(event.finalByte).toBe('m'.charCodeAt(0))
    expect(Array.from(event.params)).toEqual([
      0, 4, 3, 38, 2, 175, 175, 215, 58, 2, 0, 190, 80, 70,
    ])
    expect(Array.from(event.paramSeparators)).toEqual([
      'semicolon',
      'colon',
      'semicolon',
      'semicolon',
      'semicolon',
      'semicolon',
      'semicolon',
      'semicolon',
      'colon',
      'colon',
      'colon',
      'colon',
      'colon',
      'semicolon',
    ])
  })

  it('parses DECSCA CSI " q', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b[1"q', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch',
    )
    expect(event.finalByte).toBe('q'.charCodeAt(0))
    expect(event.intermediates).toEqual([0x22])
    expect(Array.from(event.params)).toEqual([1])
  })

  it('enforces OSC string limits', () => {
    const parser = createParser({ stringLimits: { osc: 3 } })
    const sink = new TestSink()

    parser.write('\u001b]0;abcd\u0007', sink)

    expect(parser.state).toBe(ParserState.Ground)
    expect(
      sink.events.find((event) => event.type === ParserEventType.OscDispatch),
    ).toBeUndefined()
    const last = sink.events.at(-1)
    invariant(
      last && last.type === ParserEventType.Execute,
      'expected BEL execute',
    )
    expect(last.codePoint).toBe(0x07)
  })

  it('enforces SOS string limits', () => {
    const parser = createParser({ stringLimits: { sosPmApc: 2 } })
    const sink = new TestSink()

    parser.write('\u001bXabc\u001b\\', sink)

    expect(parser.state).toBe(ParserState.Ground)
    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'expected ST escape dispatch',
    )
    expect(event.finalByte).toBe('\\'.charCodeAt(0))
  })

  it('enforces DCS string limits', () => {
    const parser = createParser({ stringLimits: { dcs: 1 } })
    const sink = new TestSink()

    parser.write('\u001bPqAB\u001b\\', sink)

    expect(parser.state).toBe(ParserState.Ground)
    expect(sink.events).toHaveLength(3)
    const [hook, put, esc] = sink.events
    invariant(hook && hook.type === ParserEventType.DcsHook, 'expected hook')
    invariant(
      put && put.type === ParserEventType.DcsPut,
      'expected chunk output',
    )
    expect(new TextDecoder().decode(put.data)).toBe('A')
    invariant(
      esc && esc.type === ParserEventType.EscDispatch,
      'expected terminator escape',
    )
  })

  it('caps DCS payloads across flush boundaries', () => {
    const limit = 2048
    const parser = createParser({ stringLimits: { dcs: limit } })
    const sink = new TestSink()

    const payload = 'X'.repeat(limit + 50)
    parser.write(`\u001bPq${payload}\u001b\\`, sink)

    const puts = sink.events.filter(
      (
        event,
      ): event is Extract<
        ParserEvent,
        { type: typeof ParserEventType.DcsPut }
      > =>
        event.type === ParserEventType.DcsPut,
    )

    const total = puts.reduce((sum, event) => sum + event.data.length, 0)

    expect(total).toBe(limit)
    expect(
      sink.events.some((event) => event.type === ParserEventType.DcsUnhook),
    ).toBe(false)
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('applies vt220 spec defaults and merges overrides', () => {
    const parser = createParser({ spec: 'vt220', stringLimits: { osc: 2 } })
    const sink = new TestSink()

    parser.write('\u001b]0;abc\u0007', sink)
    expect(
      sink.events.find((event) => event.type === ParserEventType.OscDispatch),
    ).toBeUndefined()

    parser.write('\u001bPqAB\u001b\\', sink)

    const hasUnhook = sink.events.some(
      (event) => event.type === ParserEventType.DcsUnhook,
    )
    expect(hasUnhook).toBe(true)
  })

  it('dispatches DECSET with preserved prefix and params', () => {
    const parser = createParser({ spec: 'vt220' })
    const sink = new TestSink()

    parser.write('\u001b[?25h', sink)

    const event = sink.events.at(-1)
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI',
    )
    expect(event.finalByte).toBe('h'.charCodeAt(0))
    expect(event.prefix).toBe('?'.charCodeAt(0))
    expect(event.params).toEqual([25])
  })

  it('dispatches DECRST with preserved prefix and params', () => {
    const parser = createParser({ spec: 'vt220' })
    const sink = new TestSink()

    parser.write('\u001b[?1l', sink)

    const event = sink.events.at(-1)
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI',
    )
    expect(event.finalByte).toBe('l'.charCodeAt(0))
    expect(event.prefix).toBe('?'.charCodeAt(0))
    expect(event.params).toEqual([1])
  })

  it('dispatches DA sequences with defaulted params', () => {
    const parser = createParser({ spec: 'vt220' })
    const sink = new TestSink()

    parser.write('\u001b[c', sink)

    const primary = sink.events.at(-1)
    invariant(
      primary && primary.type === ParserEventType.CsiDispatch,
      'expected CSI',
    )
    expect(primary.finalByte).toBe('c'.charCodeAt(0))
    expect(primary.prefix).toBeNull()
    expect(primary.params).toEqual([0])

    parser.write('\u001b[>0c', sink)

    const secondary = sink.events.at(-1)
    invariant(
      secondary && secondary.type === ParserEventType.CsiDispatch,
      'expected CSI',
    )
    expect(secondary.prefix).toBe('>'.charCodeAt(0))
    expect(secondary.params).toEqual([0])
  })

  it('dispatches DECSLRM margins with both parameters intact', () => {
    const parser = createParser({ spec: 'vt220' })
    const sink = new TestSink()

    parser.write('\u001b[5;40s', sink)

    const event = sink.events.at(-1)
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI',
    )
    expect(event.finalByte).toBe('s'.charCodeAt(0))
    expect(event.params).toEqual([5, 40])
  })

  it('aborts DEC DCS payloads once the preset limit is exceeded', () => {
    const parser = createParser({ spec: 'vt220', stringLimits: { dcs: 4 } })
    const sink = new TestSink()

    parser.write('\u001bPq12345\u001b\\', sink)

    const putEvents = sink.events.filter(
      (
        event,
      ): event is Extract<
        ParserEvent,
        { type: typeof ParserEventType.DcsPut }
      > =>
        event.type === ParserEventType.DcsPut,
    )

    const total = putEvents.reduce((sum, event) => sum + event.data.length, 0)
    expect(total).toBe(4)
    expect(
      sink.events.some((event) => event.type === ParserEventType.DcsUnhook),
    ).toBe(false)
  })

  it('vt100 spec ignores 8-bit CSI introducer by default', () => {
    const parser = createParser({ spec: 'vt100' })
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9b, 0x41]), sink)

    expect(
      sink.events.some((event) => event.type === ParserEventType.CsiDispatch),
    ).toBe(false)
    const printEvent = sink.events.find(
      (event) => event.type === ParserEventType.Print,
    )
    invariant(
      printEvent && printEvent.type === ParserEventType.Print,
      'expected print event',
    )
    expect(new TextDecoder().decode(printEvent.data)).toBe('A')
  })

  it('xterm emulator accepts 8-bit CSI introducer', () => {
    const parser = createParser({ emulator: 'xterm' })
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9b, 0x41]), sink)

    expect(
      sink.events.some((event) => event.type === ParserEventType.CsiDispatch),
    ).toBe(true)
  })

  it('vt320 spec expands DCS string limit to 8192 bytes', () => {
    const parser = createParser({ spec: 'vt320' })
    const sink = new TestSink()

    const payload = 'Z'.repeat(9000)
    parser.write(`\u001bPq${payload}\u001b\\`, sink)

    const puts = sink.events.filter(
      (
        event,
      ): event is Extract<
        ParserEvent,
        { type: typeof ParserEventType.DcsPut }
      > =>
        event.type === ParserEventType.DcsPut,
    )

    const total = puts.reduce((sum, event) => sum + event.data.length, 0)
    expect(total).toBe(8192)
    expect(
      sink.events.some((event) => event.type === ParserEventType.DcsUnhook),
    ).toBe(false)
  })

  it('xterm emulator raises OSC payload limit to 16384 bytes', () => {
    const parser = createParser({ emulator: 'xterm' })
    const sink = new TestSink()

    const payload = '0;'.concat('A'.repeat(17000))
    parser.write(`\u001b]${payload}\u0007`, sink)

    expect(
      sink.events.find((event) => event.type === ParserEventType.OscDispatch),
    ).toBeUndefined()
    const execute = sink.events.at(-1)
    invariant(
      execute && execute.type === ParserEventType.Execute,
      'expected BEL execute',
    )
    expect(execute.codePoint).toBe(0x07)
  })

  it('xterm emulator preserves user-specified spec overrides', () => {
    const parser = createParser({ spec: 'vt220', emulator: 'xterm' })
    const sink = new TestSink()

    const payload = '0;'.concat('A'.repeat(17000))
    parser.write(`\u001b]${payload}\u0007`, sink)

    expect(
      sink.events.find((event) => event.type === ParserEventType.OscDispatch),
    ).toBeUndefined()

    parser.write(new Uint8Array([0x9b, 0x41]), sink)

    expect(
      sink.events.some((event) => event.type === ParserEventType.CsiDispatch),
    ).toBe(true)
  })

  it('kitty emulator extends OSC payload allowance to 32768 bytes', () => {
    const parser = createParser({ emulator: 'kitty' })
    const sink = new TestSink()

    const acceptedPayload = '0;'.concat('K'.repeat(30000))
    parser.write(`\u001b]${acceptedPayload}\u0007`, sink)

    expect(
      sink.events.some((event) => event.type === ParserEventType.OscDispatch),
    ).toBe(true)

    const overflowParser = createParser({ emulator: 'kitty' })
    const overflowSink = new TestSink()
    const overflowPayload = '0;'.concat('K'.repeat(40000))
    overflowParser.write(`\u001b]${overflowPayload}\u0007`, overflowSink)

    expect(
      overflowSink.events.some(
        (event) => event.type === ParserEventType.OscDispatch,
      ),
    ).toBe(false)
  })

  it('parses SOS string via ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bXsystem message\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.SosPmApcDispatch,
      'expected SOS dispatch',
    )
    expect(event.kind).toBe('SOS')
    expect(new TextDecoder().decode(event.data)).toBe('system message')
  })

  it('parses PM string via ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b^private\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.SosPmApcDispatch,
      'expected PM dispatch',
    )
    expect(event.kind).toBe('PM')
    expect(new TextDecoder().decode(event.data)).toBe('private')
  })

  it('parses APC string via ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b_command\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.SosPmApcDispatch,
      'expected APC dispatch',
    )
    expect(event.kind).toBe('APC')
    expect(new TextDecoder().decode(event.data)).toBe('command')
  })

  it('supports C1 SOS introducer', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x98, 0x41, 0x9c]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.SosPmApcDispatch,
      'expected SOS dispatch',
    )
    expect(event.kind).toBe('SOS')
    expect(new TextDecoder().decode(event.data)).toBe('A')
  })

  it('cancels SOS string on CAN', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bXcancel\u0018tail', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.Print,
      'expected print after cancel',
    )
    expect(new TextDecoder().decode(event.data)).toBe('tail')
  })

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

    const params = Array.from({ length: 20 }, () => '1').join(';')
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

  it('parses OSC terminated by BEL', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b]0;hello\u0007', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.OscDispatch,
      'expected OSC',
    )
    expect(new TextDecoder().decode(event.data)).toBe('0;hello')
  })

  it('parses OSC terminated by ST', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b]1;world\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.OscDispatch,
      'expected OSC',
    )
    expect(new TextDecoder().decode(event.data)).toBe('1;world')
  })

  it('supports OSC 8-bit introducer', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x9d, 0x32, 0x3b, 0x41, 0x07]), sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.OscDispatch,
      'expected OSC',
    )
    expect(new TextDecoder().decode(event.data)).toBe('2;A')
  })

  it('cancels OSC on CAN', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001b]52;foo\u0018bar', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(event && event.type === ParserEventType.Print, 'expected print')
    expect(new TextDecoder().decode(event.data)).toBe('bar')
  })

  it('emits DCS hook/put/unhook events', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP1;2+qhello\u001b\\', sink)

    expect(sink.events).toHaveLength(3)
    const [hook, put, unhook] = sink.events

    invariant(
      hook && hook.type === ParserEventType.DcsHook,
      'expected DCS hook',
    )
    expect(hook.params).toEqual([1, 2])
    expect(hook.intermediates).toEqual(['+'.charCodeAt(0)])
    expect(hook.finalByte).toBe('q'.charCodeAt(0))

    invariant(put && put.type === ParserEventType.DcsPut, 'expected DCS put')
    expect(new TextDecoder().decode(put.data)).toBe('hello')

    invariant(
      unhook && unhook.type === ParserEventType.DcsUnhook,
      'expected DCS unhook',
    )
  })

  it('cancels DCS on CAN without unhook', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP0;0rdata\u0018', sink)

    expect(sink.events).toHaveLength(2)
    const [hook, put] = sink.events
    invariant(hook && hook.type === ParserEventType.DcsHook, 'expected hook')
    invariant(put && put.type === ParserEventType.DcsPut, 'expected data flush')
    expect(new TextDecoder().decode(put.data)).toBe('data')
  })

  it('supports 8-bit DCS introducer', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write(new Uint8Array([0x90, 0x30, 0x6d, 0x41, 0x42, 0x9c]), sink)

    expect(sink.events).toHaveLength(3)
    const [hook, put, unhook] = sink.events
    invariant(hook && hook.type === ParserEventType.DcsHook, 'hook')
    expect(hook.params).toEqual([0])
    expect(hook.finalByte).toBe('m'.charCodeAt(0))
    invariant(put && put.type === ParserEventType.DcsPut, 'put')
    expect(new TextDecoder().decode(put.data)).toBe('AB')
    invariant(unhook && unhook.type === ParserEventType.DcsUnhook, 'unhook')
  })

  it('flushes DCS buffer at threshold', () => {
    const parser = createParser()
    const sink = new TestSink()

    const payload = 'x'.repeat(1025)
    parser.write(`\u001bPq${payload}\u001b\\`, sink)

    expect(sink.events).toHaveLength(4)
    const [hook, put1, put2, unhook] = sink.events
    invariant(hook && hook.type === ParserEventType.DcsHook, 'hook expected')
    invariant(
      put1 && put1.type === ParserEventType.DcsPut,
      'first put expected',
    )
    invariant(
      put2 && put2.type === ParserEventType.DcsPut,
      'second put expected',
    )
    expect(put1.data.byteLength).toBe(1024)
    expect(put2.data.byteLength).toBe(1)
    invariant(
      unhook && unhook.type === ParserEventType.DcsUnhook,
      'unhook expected',
    )
  })

  it('enters DCS ignore on repeated prefix', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP?=q\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'expected terminator only',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('forces DCS ignore on unexpected control', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP \u0001q\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'terminator expected',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('cancels DCS ignore with CAN', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP?=\u0018', sink)

    expect(sink.events).toHaveLength(0)
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('returns to escape from DCS ignore on ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP?=\u001b[33m', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI after ESC',
    )
    expect(event.finalByte).toBe('m'.charCodeAt(0))
  })

  it('escapes DCS param with ESC re-entry', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP1\u001b[32m', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI after ESC',
    )
    expect(event.finalByte).toBe('m'.charCodeAt(0))
  })

  it('treats ESC followed by non-ST as data inside DCS', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bPq\u001bX\u001b\\', sink)

    expect(sink.events).toHaveLength(3)
    const [, put] = sink.events
    invariant(put && put.type === ParserEventType.DcsPut, 'expected DCS data')
    expect(Array.from(put.data)).toEqual([0x1b, 'X'.charCodeAt(0)])
  })

  it('cancels empty DCS without emitting put', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bPq\u0018', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.DcsHook,
      'hook expected only',
    )
  })

  it('cancels DCS param on CAN', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP1\u0018', sink)

    expect(sink.events).toHaveLength(0)
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('cancels DCS intermediate on CAN', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP \u0018', sink)

    expect(sink.events).toHaveLength(0)
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('escapes from DCS intermediate on ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP \u001b[34m', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch',
    )
    expect(event.finalByte).toBe('m'.charCodeAt(0))
  })

  it('ignores unexpected control in DCS param', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP1\u0001q\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'terminator expected',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('ignores overflowing DCS parameters', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP999999q\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'only terminator should emit',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('ignores DCS with excessive parameter count', () => {
    const parser = createParser()
    const sink = new TestSink()

    const params = Array.from({ length: 17 }, () => '1').join(';')
    parser.write(`\u001bP${params}q\u001b\\`, sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'terminator expected',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('escapes DCS entry on ESC', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP\u001b[35m', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.CsiDispatch,
      'expected CSI dispatch',
    )
    expect(event.finalByte).toBe('m'.charCodeAt(0))
  })

  it('ignores unexpected control at DCS entry', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP\u0001q\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'terminator expected',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })

  it('limits DCS intermediates before entering ignore', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('\u001bP \u0020\u0020\u0020\u0020\u0020q\u001b\\', sink)

    expect(sink.events).toHaveLength(1)
    const event = sink.events[0]
    invariant(
      event && event.type === ParserEventType.EscDispatch,
      'terminator expected',
    )
    expect(parser.state).toBe(ParserState.Ground)
  })
})

const encoder = new TextEncoder()
const UTF8_REPLACEMENT = [0xef, 0xbf, 0xbd]

describe('ParserImpl UTF-8 handling', () => {
  it('emits multibyte sequences once complete', () => {
    const parser = createParser()
    const sink = new TestSink()

    parser.write('👋', sink)

    const printEvents = sink.events.filter(
      (event) => event.type === ParserEventType.Print,
    )
    expect(printEvents).toHaveLength(1)
    const data =
      printEvents[0]?.type === ParserEventType.Print
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
    const data =
      printEvents[0]?.type === ParserEventType.Print
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
