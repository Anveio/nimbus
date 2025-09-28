import { describe, expect, it } from 'vitest'
import type { TerminalUpdate } from '../src/interpreter/delta'
import {
  createInterpreter,
  type TerminalInterpreter,
} from '../src/interpreter/terminal-interpreter'
import { createParser } from '../src/parser'
import type { ParserEvent, ParserEventSink, ParserOptions } from '../src/types'

class InterpreterSink implements ParserEventSink {
  constructor(
    private readonly interpreter: TerminalInterpreter,
    private readonly updates: TerminalUpdate[][],
  ) {}

  onEvent(event: ParserEvent): void {
    this.updates.push(this.interpreter.handleEvent(event))
  }
}

const run = (input: string, options: ParserOptions = {}) => {
  const parser = createParser(options)
  const interpreter = createInterpreter({ parser: options })
  const updates: TerminalUpdate[][] = []
  const sink = new InterpreterSink(interpreter, updates)
  parser.write(input, sink)
  return { updates, interpreter }
}

describe('TerminalInterpreter basic behaviour', () => {
  it('renders printable characters and advances the cursor', () => {
    const { interpreter } = run('hi')
    const state = interpreter.snapshot

    expect(state.buffer[0]![0]!.char).toBe('h')
    expect(state.buffer[0]![1]!.char).toBe('i')
    expect(state.cursor.row).toBe(0)
    expect(state.cursor.column).toBe(2)
  })

  it('wraps to next line when reaching end of row', () => {
    const { interpreter } = run('a'.repeat(81))
    const state = interpreter.snapshot

    expect(state.buffer[0]![79]!.char).toBe('a')
    expect(state.buffer[1]![0]!.char).toBe('a')
    expect(state.cursor.row).toBe(1)
    expect(state.cursor.column).toBe(1)
  })

  it('handles newline execute and carriage return', () => {
    const { interpreter } = run('hi\nthere\r!')
    const state = interpreter.snapshot

    expect(state.buffer[0]![0]!.char).toBe('h')
    expect(state.buffer[1]![0]!.char).toBe('!')
    expect(state.buffer[1]![1]!.char).toBe('h')
    expect(state.buffer[1]![4]!.char).toBe('e')
    expect(state.cursor.row).toBe(1)
    expect(state.cursor.column).toBe(1)
  })

  it('clears the screen with CSI 2J and positions cursor with CSI H', () => {
    const { interpreter } = run('seed\x1b[2J\x1b[10;10Hmark')
    const state = interpreter.snapshot

    expect(state.buffer[0]![0]!.char).toBe(' ')
    expect(state.buffer[9]![9]!.char).toBe('m')
    expect(state.buffer[9]![12]!.char).toBe('k')
    expect(state.cursor.row).toBe(9)
    expect(state.cursor.column).toBe(13)
  })

  it('applies bold and color attributes via SGR', () => {
    const { interpreter } = run('\x1b[31;1mR\x1b[0m')
    const state = interpreter.snapshot

    const redCell = state.buffer[0]![0]!
    expect(redCell!.char).toBe('R')
    expect(redCell!.attr.bold).toBe(true)
    expect(redCell!.attr.fg).toBe(1)

    const afterReset = state.attributes
    expect(afterReset.bold).toBe(false)
    expect(afterReset.fg).toBeNull()
  })

  it('exposes emitted updates for downstream renderers', () => {
    const { updates } = run('OK')
    const flattened = updates.flat()

    expect(flattened.some((update) => update.type === 'cells')).toBe(true)
    expect(flattened.some((update) => update.type === 'cursor')).toBe(true)
  })

  it('uses tab stops for horizontal tab, including HTS and TBC', () => {
    const sequence = '\x1b[3g\x1b[1;1H\x1b[5G\x1bH\x1b[1G\tX'
    const { interpreter } = run(sequence)
    const state = interpreter.snapshot

    expect(state.cursor.column).toBe(5)
    expect(state.buffer[0]![4]!.char).toBe('X')
  })

  it('scrolls within the defined scroll region on line feed', () => {
    const { interpreter } = run('\x1b[2;4r\x1b[4;1Hline4\nnext')
    const state = interpreter.snapshot

    expect(state.buffer[3]![0]!.char).toBe('n')
    expect(state.buffer[2]![0]!.char).toBe('l')
  })

  it('respects origin mode when positioning the cursor', () => {
    const { interpreter } = run('\x1b[3;5r\x1b[?6h\x1b[H')
    const state = interpreter.snapshot

    expect(state.cursor.row).toBe(2)
    expect(state.cursor.column).toBe(0)
  })

  it('toggles autowrap via DEC private mode', () => {
    const sequence = '\x1b[?7l' + 'A'.repeat(82) + '\x1b[?7hBC'
    const { interpreter } = run(sequence)
    const state = interpreter.snapshot

    expect(state.buffer[0]![79]!.char).toBe('B')
    expect(state.buffer[1]![0]!.char).toBe('C')
    expect(state.cursor.row).toBe(1)
    expect(state.cursor.column).toBe(1)
  })

  it('honours cursor visibility toggles', () => {
    const { interpreter } = run('\x1b[?25l\x1b[?25h')
    const state = interpreter.snapshot

    expect(state.cursorVisible).toBe(true)
  })

  it('supports save and restore cursor sequences', () => {
    const { interpreter } = run('AB\x1b7\x1b[10;10HC\x1b8D')
    const state = interpreter.snapshot

    expect(state.cursor.row).toBe(0)
    expect(state.cursor.column).toBe(3)
    expect(state.buffer[0]![2]!.char).toBe('D')
  })

  it('performs reverse index within the scroll region', () => {
    const sequence = '\x1b[2;4r\x1b[2;1Htop\x1b[4;1Hbottom\x1b[2;1H\x1bM'
    const { interpreter } = run(sequence)
    const state = interpreter.snapshot

    expect(state.buffer[1]![0]!.char).toBe(' ')
    expect(state.buffer[2]![0]!.char).toBe('t')
  })
})
