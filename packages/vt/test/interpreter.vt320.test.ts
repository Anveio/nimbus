import { describe, expect, it } from 'vitest'
import { createParser } from '../src/parser'
import {
  type ParserEvent,
  type ParserEventSink,
  type ParserOptions,
} from '../src/types'
import type { TerminalUpdate } from '../src/interpreter/delta'
import { createInterpreter, type TerminalInterpreter } from '../src/interpreter/terminal-interpreter'

class RecordingSink implements ParserEventSink {
  constructor(
    private readonly interpreter: TerminalInterpreter,
    private readonly updates: TerminalUpdate[][],
  ) {}

  onEvent(event: ParserEvent): void {
    this.updates.push(this.interpreter.handleEvent(event))
  }
}

const createHarness = (options: ParserOptions = { spec: 'vt320' }) => {
  const parser = createParser(options)
  const interpreter = createInterpreter({ parser: options })
  const updates: TerminalUpdate[][] = []
  const sink = new RecordingSink(interpreter, updates)
  return { parser, interpreter, sink, updates }
}

describe('VT320 capabilities', () => {
  it('responds to DA/DA2 with VT320 signatures respecting C1 mode', () => {
    const { parser, sink, updates } = createHarness()

    parser.write('\u001B[c', sink)
    let responses = updates
      .flat()
      .filter((update) => update.type === 'response')
    expect(responses).toHaveLength(1)
    if (responses[0]?.type === 'response') {
      expect(Array.from(responses[0].data)).toEqual([
        0xc2,
        0x9b,
        0x3f,
        0x36,
        0x32,
        0x3b,
        0x31,
        0x3b,
        0x32,
        0x3b,
        0x36,
        0x3b,
        0x37,
        0x3b,
        0x38,
        0x3b,
        0x39,
        0x63,
      ])
    }

    updates.length = 0
    parser.write('\u001B[>c', sink)
    responses = updates.flat().filter((update) => update.type === 'response')
    expect(responses).toHaveLength(1)
    if (responses[0]?.type === 'response') {
      expect(Array.from(responses[0].data)).toEqual([
        0xc2,
        0x9b,
        0x3e,
        0x36,
        0x32,
        0x3b,
        0x31,
        0x3b,
        0x32,
        0x63,
      ])
    }
  })

  it('toggles C1 transmission with S7C1T/S8C1T', () => {
    const { parser, sink, updates, interpreter } = createHarness()

    expect(interpreter.snapshot.c1Transmission).toBe('8-bit')

    parser.write('\u001B[?66h', sink)
    const firstPassUpdates = updates.flat()
    expect(
      firstPassUpdates.some(
        (update) =>
          update.type === 'c1-transmission' && update.value === '7-bit',
      ),
    ).toBe(true)
    expect(interpreter.snapshot.c1Transmission).toBe('7-bit')

    updates.length = 0
    parser.write('\u001B[c', sink)
    const responses = updates
      .flat()
      .filter((update) => update.type === 'response')
    expect(responses).toHaveLength(1)
    if (responses[0]?.type === 'response') {
      expect(Array.from(responses[0].data.slice(0, 2))).toEqual([0x1b, 0x5b])
    }

    updates.length = 0
    parser.write('\u001B[?66l', sink)
    const secondPassUpdates = updates.flat()
    expect(
      secondPassUpdates.some(
        (update) =>
          update.type === 'c1-transmission' && update.value === '8-bit',
      ),
    ).toBe(true)
    expect(interpreter.snapshot.c1Transmission).toBe('8-bit')

    updates.length = 0
    parser.write('\u001B[c', sink)
    const finalResponses = updates
      .flat()
      .filter((update) => update.type === 'response')
    expect(finalResponses).toHaveLength(1)
    if (finalResponses[0]?.type === 'response') {
      expect(Array.from(finalResponses[0].data.slice(0, 2))).toEqual([
        0xc2,
        0x9b,
      ])
    }
  })

  it('translates NRCS glyphs after designation', () => {
    const { parser, sink, interpreter } = createHarness()

    parser.write('\u001B(A#', sink)
    const ukCell = interpreter.snapshot.buffer[0]?.[0]
    expect(ukCell?.char).toBe('£')

    parser.reset()
    interpreter.reset()

    parser.write('\u001B(K[', sink)
    const germanCell = interpreter.snapshot.buffer[0]?.[0]
    expect(germanCell?.char).toBe('Ä')
  })
})
