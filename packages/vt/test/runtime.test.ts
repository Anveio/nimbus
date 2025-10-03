import { describe, expect, it } from 'vitest'
import type { TerminalUpdate } from '../src/interpreter-internals/delta'
import { createTerminalRuntime } from '../src/runtime'
import type { ParserEventSink } from '../src/types'
import { ParserEventType } from '../src/types'

describe('createTerminalRuntime', () => {
  it('writes printable data and updates interpreter snapshot', () => {
    const runtime = createTerminalRuntime()
    const updates = runtime.write('hello')

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    const row = runtime.snapshot.buffer[0]!.slice(0, 5)
      .map((cell) => cell.char)
      .join('')
    expect(row).toBe('hello')
    expect(runtime.snapshot.cursor.column).toBe(5)
  })

  it('accepts raw byte input without re-encoding', () => {
    const runtime = createTerminalRuntime()
    const bytes = new TextEncoder().encode('bytes')
    const updates = runtime.writeBytes(bytes)

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    const row = runtime.snapshot.buffer[0]!.slice(0, 5)
      .map((cell) => cell.char)
      .join('')
    expect(row).toBe('bytes')
  })

  it('overrides capability features while keeping parser wiring consistent', () => {
    const runtime = createTerminalRuntime({
      spec: 'vt320',
      features: {
        initialRows: 48,
        initialColumns: 132,
      },
    })

    expect(runtime.snapshot.rows).toBe(48)
    expect(runtime.snapshot.columns).toBe(132)
    expect(runtime.interpreter.capabilities.spec).toBe('vt320')
  })

  it('routes parser events to the interpreter via handleEvents', () => {
    const runtime = createTerminalRuntime()
    const data = new TextEncoder().encode('A')
    const updates = runtime.handleEvents([
      { type: ParserEventType.Print, data },
    ])

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    expect(runtime.snapshot.buffer[0]![0]!.char).toBe('A')
  })

  it('resets both parser and interpreter state', () => {
    const runtime = createTerminalRuntime()
    runtime.write('data')
    expect(runtime.snapshot.cursor.column).toBe(4)

    runtime.reset()

    expect(runtime.snapshot.cursor.column).toBe(0)
    const rowContents = runtime.snapshot.buffer[0]!.slice(0, 4)
      .map((cell) => cell.char)
      .join('')
    expect(rowContents.trim()).toBe('')
  })

  it('constructs an interpreter with a default printer controller', () => {
    const runtime = createTerminalRuntime()

    runtime.write('\u001b[?5i')
    runtime.write('PRINT')

    expect(runtime.interpreter.snapshot.printer.controller).toBe(true)
    expect(runtime.interpreter.snapshot.printer.autoPrint).toBe(false)

    runtime.write('\u001b[4i')
    expect(runtime.interpreter.snapshot.printer.controller).toBe(false)

    runtime.write('\u001b[?4i')
    expect(runtime.interpreter.snapshot.printer.autoPrint).toBe(true)
  })

  it('exposes the underlying parser for advanced usage', () => {
    const runtime = createTerminalRuntime()
    const updates: TerminalUpdate[] = []
    const sink: ParserEventSink = {
      onEvent: (event) => {
        updates.push(...runtime.interpreter.handleEvent(event))
      },
    }

    runtime.parser.write('hi', sink)

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    const text = runtime.snapshot.buffer[0]!.slice(0, 2)
      .map((cell) => cell.char)
      .join('')
    expect(text).toBe('hi')
  })
})
