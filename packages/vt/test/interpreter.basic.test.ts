import { describe, expect, it } from 'vitest'
import { createParser } from '../src/parser'
import {
  type ParserEvent,
  type ParserEventSink,
  type ParserOptions,
} from '../src/types'
import { createInterpreter, TerminalInterpreter } from '../src/interpreter/terminal-interpreter'
import type { TerminalUpdate } from '../src/interpreter/delta'

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

    expect(state.buffer[0][0].char).toBe('h')
    expect(state.buffer[0][1].char).toBe('i')
    expect(state.cursor.row).toBe(0)
    expect(state.cursor.column).toBe(2)
  })

  it('wraps to next line when reaching end of row', () => {
    const { interpreter } = run('a'.repeat(81))
    const state = interpreter.snapshot

    expect(state.buffer[0][79].char).toBe('a')
    expect(state.buffer[1][0].char).toBe('a')
    expect(state.cursor.row).toBe(1)
    expect(state.cursor.column).toBe(1)
  })

  it('handles newline execute and carriage return', () => {
    const { interpreter } = run('hi\nthere\r!')
    const state = interpreter.snapshot

    expect(state.buffer[0][0].char).toBe('h')
    expect(state.buffer[1][0].char).toBe('!')
    expect(state.buffer[1][1].char).toBe('h')
    expect(state.buffer[1][4].char).toBe('e')
    expect(state.cursor.row).toBe(1)
    expect(state.cursor.column).toBe(1)
  })

  it('clears the screen with CSI 2J and positions cursor with CSI H', () => {
    const { interpreter } = run('seed\x1b[2J\x1b[10;10Hmark')
    const state = interpreter.snapshot

    expect(state.buffer[0][0].char).toBe(' ')
    expect(state.buffer[9][9].char).toBe('m')
    expect(state.buffer[9][12].char).toBe('k')
    expect(state.cursor.row).toBe(9)
    expect(state.cursor.column).toBe(13)
  })

  it('applies bold and color attributes via SGR', () => {
    const { interpreter } = run('\x1b[31;1mR\x1b[0m')
    const state = interpreter.snapshot

    const redCell = state.buffer[0][0]
    expect(redCell.char).toBe('R')
    expect(redCell.attr.bold).toBe(true)
    expect(redCell.attr.fg).toBe(1)

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
})
