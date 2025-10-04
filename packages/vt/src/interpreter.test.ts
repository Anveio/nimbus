import { describe, expect, it } from 'vitest'
import { createInterpreter, type TerminalInterpreter } from './interpreter'
import type { TerminalUpdate } from './interpreter-internals/delta'
import type { TerminalSelection } from './interpreter-internals/selection'
import { createParser } from './parser'
import type { Parser, ParserEvent, ParserEventSink, ParserOptions } from './types'
import type { PrinterController } from './utils/printer'

class InterpreterSink implements ParserEventSink {
  constructor(
    private readonly interpreter: TerminalInterpreter,
    private readonly updates: TerminalUpdate[][],
  ) {}

  onEvent(event: ParserEvent): void {
    this.updates.push(this.interpreter.handleEvent(event))
  }
}

class RecordingPrinterController implements PrinterController {
  readonly controllerStates: boolean[] = []
  readonly autoPrintStates: boolean[] = []
  readonly printScreens: string[][] = []
  readonly writes: string[] = []

  setPrinterControllerMode(enabled: boolean): void {
    this.controllerStates.push(enabled)
  }

  setAutoPrintMode(enabled: boolean): void {
    this.autoPrintStates.push(enabled)
  }

  printScreen(lines: ReadonlyArray<string>): void {
    this.printScreens.push([...lines])
  }

  write(data: Uint8Array): void {
    this.writes.push(new TextDecoder().decode(data))
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

const normaliseDeviceAttributes = (data: Uint8Array): number[] => {
  const bytes = Array.from(data)
  if (bytes.length === 0) {
    return []
  }
  if (bytes[0] === 0x9b) {
    return bytes.slice(1)
  }
  if (bytes[0] === 0x1b && bytes[1] === 0x5b) {
    return bytes.slice(2)
  }
  return bytes
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

  it('relies on host-issued space overwrite around BS for destructive erase', () => {
    const { interpreter } = run('foo\b \bx')
    const row = interpreter.snapshot.buffer[0]!

    expect(
      row
        .slice(0, 3)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('fox')
    expect(interpreter.snapshot.cursor.column).toBe(3)
  })

  it('treats DEL as a no-op in keeping with VT100/xterm semantics', () => {
    const { interpreter } = run('foo\x7f')
    const row = interpreter.snapshot.buffer[0]!

    expect(
      row
        .slice(0, 3)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('foo')
    expect(interpreter.snapshot.cursor.column).toBe(3)
  })

  it('shifts characters left with CSI P delete character', () => {
    const { interpreter } = run('abcd\x1b[H\x1b[P')
    const row = interpreter.snapshot.buffer[0]!

    expect(
      row
        .slice(0, 3)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('bcd')
    expect(row[3]!.char).toBe(' ')
    expect(interpreter.snapshot.cursor.column).toBe(0)
  })

  it('aliases legacy ESC 1/2 double-height controls', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const sink = new InterpreterSink(interpreter, [])

    parser.write('\u001b1', sink)
    expect(interpreter.snapshot.lineAttributes[0]).toBe('double-top')

    parser.write('\n\u001b2', sink)
    expect(interpreter.snapshot.lineAttributes[1]).toBe('double-bottom')
  })

  it('toggles reverse video via DECSCNM', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const sink = new InterpreterSink(interpreter, [])

    expect(interpreter.snapshot.reverseVideo).toBe(false)

    parser.write('\u001b[?5h', sink)
    expect(interpreter.snapshot.reverseVideo).toBe(true)

    parser.write('\u001b[?5l', sink)
    expect(interpreter.snapshot.reverseVideo).toBe(false)
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
    expect(redCell!.attr.foreground).toEqual({ type: 'ansi', index: 1 })
    expect(redCell!.attr.background).toEqual({ type: 'default' })

    const afterReset = state.attributes
    expect(afterReset.bold).toBe(false)
    expect(afterReset.foreground).toEqual({ type: 'default' })
    expect(afterReset.background).toEqual({ type: 'default' })
  })

  it('renders DEC special graphics when designated on G0', () => {
    const { interpreter } = run('\u001b(0qqqq\u001b(B')
    const row = interpreter.snapshot.buffer[0]!
    expect(
      row
        .slice(0, 4)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('────')
  })

  it('inserts characters with CSI @', () => {
    const { interpreter } = run('HELLO\u001b[3D\u001b[2@')
    const row = interpreter.snapshot.buffer[0]!
    expect(
      row
        .slice(0, 7)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('HE  LLO')
  })

  it('deletes characters with CSI P', () => {
    const { interpreter } = run('ABCDE\u001b[3D\u001b[2P')
    const row = interpreter.snapshot.buffer[0]!
    expect(
      row
        .map((cell) => cell.char)
        .join('')
        .trimEnd(),
    ).toBe('ABE')
  })

  it('erases characters with CSI X', () => {
    const { interpreter } = run('TEXT\u001b[2D\u001b[2X')
    const row = interpreter.snapshot.buffer[0]!
    expect(
      row
        .map((cell) => cell.char)
        .join('')
        .slice(0, 4),
    ).toBe('TE  ')
  })

  it('applies SGR sequences with colon separators', () => {
    const { interpreter } = run(
      '\u001b[;4:3;38;2;175;175;215;58:2::190:80:70mX',
    )
    const cell = interpreter.snapshot.buffer[0]![0]!
    expect(cell.char).toBe('X')
    expect(cell.attr.foreground).toEqual({
      type: 'rgb',
      r: 175,
      g: 175,
      b: 215,
    })
    expect(cell.attr.underline).not.toBe('none')
    expect(cell.attr.italic).toBe(false)
  })

  it('designates G2 and locks it into GL', () => {
    const { interpreter } = run('\u001b*0\u001bnqq')
    const row = interpreter.snapshot.buffer[0]!
    expect(row[0]!.char).toBe('─')
    expect(row[1]!.char).toBe('─')
  })

  it('honours insert mode toggles with CSI 4 h/l', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const sink = new InterpreterSink(interpreter, [])

    parser.write('ABCD', sink)
    parser.write('\u001b[2D', sink)
    parser.write('X', sink)
    const afterReplace = interpreter.snapshot.buffer[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(afterReplace, 'IRM off should overwrite existing cells').toBe('ABXD')

    parser.write('\u001b[4h', sink)
    parser.write('Y', sink)
    const afterInsert = interpreter.snapshot.buffer[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(afterInsert, 'IRM on should shift cells to the right').toBe('ABXY')

    parser.write('\u001b[4l', sink)
    parser.write('Z', sink)
    const afterOverwrite = interpreter.snapshot.buffer[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(
      afterOverwrite,
      'IRM off after toggle should overwrite at cursor',
    ).toBe('ABXYZ')
  })

  it('handles single shift SS2 without altering GL', () => {
    const { interpreter } = run('\u001b*0q\u001bNqX')
    const row = interpreter.snapshot.buffer[0]!
    expect(row[0]!.char).toBe('q')
    expect(row[1]!.char).toBe('─')
    expect(row[2]!.char).toBe('X')
  })

  it('sets double-height line attributes', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const sink = new InterpreterSink(interpreter, [])

    parser.write('\u001b#3', sink)
    expect(interpreter.snapshot.lineAttributes[0]).toBe('double-top')

    parser.write('\r\n\u001b#4', sink)
    expect(interpreter.snapshot.lineAttributes[1]).toBe('double-bottom')

    parser.write('\u001b#5', sink)
    expect(interpreter.snapshot.lineAttributes[1]).toBe('single')
  })

  it('performs selective erase respecting DECSCA', () => {
    const { interpreter } = run('\u001b[1"qP\u001b[0"qQ\u001b[1;1H\u001b[?0J')
    const row = interpreter.snapshot.buffer[0]!
    expect(row[0]!.char).toBe('P')
    expect(row[0]!.protected).toBe(true)
    expect(row[1]!.char).toBe(' ')
  })

  it('emits DA response', () => {
    const { updates } = run('\u001b[>0c')
    const responses = updates
      .flat()
      .filter(
        (update): update is Extract<TerminalUpdate, { type: 'response' }> =>
          update.type === 'response',
      )
      .map((update) => normaliseDeviceAttributes(update.data))
    expect(responses).toContainEqual([
      0x3e, 0x36, 0x32, 0x3b, 0x31, 0x3b, 0x32, 0x63,
    ])
  })

  it('responds to device status reports', () => {
    const { updates } = run('\u001b[5n\u001b[6n')
    const responseStrings = updates
      .flat()
      .filter(
        (update): update is Extract<TerminalUpdate, { type: 'response' }> =>
          update.type === 'response',
      )
      .map((update) =>
        String.fromCharCode(...normaliseDeviceAttributes(update.data)),
      )

    expect(responseStrings).toContain('0n')
    expect(responseStrings).toContain('1;1R')
  })

  it('implements DECID, answerback programming, and ENQ', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const updates: TerminalUpdate[][] = []
    const sink = new InterpreterSink(interpreter, updates)

    parser.write('\u001bZ', sink)
    const decidResponses = updates
      .flat()
      .filter(
        (update): update is Extract<TerminalUpdate, { type: 'response' }> =>
          update.type === 'response',
      )
      .map((update) => Array.from(update.data))
    expect(decidResponses).toContainEqual([0x1b, 0x2f, 0x5a])

    updates.length = 0
    parser.write('\u001bP$qCUSTOM-ANSWERBACK\u001b\\', sink)
    expect(interpreter.snapshot.answerback).toBe('CUSTOM-ANSWERBACK')

    updates.length = 0
    parser.write('\u0005', sink) // ENQ
    const answerbackResponses = updates
      .flat()
      .filter(
        (update): update is Extract<TerminalUpdate, { type: 'response' }> =>
          update.type === 'response',
      )
      .map((update) => Array.from(update.data))
    expect(answerbackResponses).toContainEqual(
      Array.from('CUSTOM-ANSWERBACK').map((char) => char.charCodeAt(0)),
    )
  })

  it('handles printer controller media copy sequences', () => {
    const printer = new RecordingPrinterController()
    const parser = createParser()
    const interpreter = createInterpreter({ printer })
    const updates: TerminalUpdate[][] = []
    const sink = new InterpreterSink(interpreter, updates)

    parser.write('\u001b[?5i', sink)
    parser.write('PRINT', sink)
    expect(printer.controllerStates).toContain(true)
    expect(printer.writes.some((entry) => entry.includes('PRINT'))).toBe(true)

    updates.length = 0
    parser.write('\u001b[4i', sink)
    parser.write('NOPE', sink)
    expect(printer.controllerStates).toContain(false)
    expect(printer.writes.some((entry) => entry.includes('NOPE'))).toBe(false)

    updates.length = 0
    parser.write('\u001b[0i', sink)
    expect(printer.printScreens.length).toBeGreaterThan(0)

    updates.length = 0
    parser.write('\u001b[?4i', sink)
    expect(printer.autoPrintStates).toContain(true)
  })

  it('inserts and deletes lines within the scroll region', () => {
    const sequence = 'line1\r\nline2\r\nline3\u001b[2;1H\u001b[1L'
    const { interpreter } = run(sequence)
    const snapshot = interpreter.snapshot
    expect(
      snapshot.buffer[0]!.map((cell) => cell.char)
        .join('')
        .trimEnd(),
    ).toBe('line1')
    expect(
      snapshot.buffer[1]!.map((cell) => cell.char)
        .join('')
        .trimEnd(),
    ).toBe('')
    expect(
      snapshot.buffer[2]!.map((cell) => cell.char)
        .join('')
        .trimEnd(),
    ).toBe('line2')
  })

  it('deletes lines with CSI M', () => {
    const sequence = 'line1\r\nline2\r\nline3\u001b[2;1H\u001b[1M'
    const { interpreter } = run(sequence)
    const snapshot = interpreter.snapshot
    expect(
      snapshot.buffer[0]!.map((cell) => cell.char)
        .join('')
        .trimEnd(),
    ).toBe('line1')
    expect(
      snapshot.buffer[1]!.map((cell) => cell.char)
        .join('')
        .trimEnd(),
    ).toBe('line3')
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

  it('supports extended SGR attributes including underline and palette colours', () => {
    const sequence = '\u001b[3;4;5;7;9;38;2;255;128;64;48;5;123mX'
    const { interpreter } = run(sequence)
    const state = interpreter.snapshot

    const cell = state.buffer[0]![0]!
    expect(cell.char).toBe('X')
    expect(cell.attr.italic).toBe(true)
    expect(cell.attr.underline).toBe('single')
    expect(cell.attr.blink).toBe('slow')
    expect(cell.attr.inverse).toBe(true)
    expect(cell.attr.strikethrough).toBe(true)
    expect(cell.attr.foreground).toEqual({ type: 'rgb', r: 255, g: 128, b: 64 })
    expect(cell.attr.background).toEqual({ type: 'palette', index: 123 })
  })

  it('surfaces OSC title updates and stores state', () => {
    const { interpreter, updates } = run('\u001b]0;mana terminal\u0007')
    const flattened = updates.flat()

    expect(interpreter.snapshot.title).toBe('mana terminal')
    expect(flattened.some((update) => update.type === 'osc')).toBe(true)
    expect(flattened.some((update) => update.type === 'title')).toBe(true)
  })

  it('captures OSC 52 clipboard payloads', () => {
    const sequence = '\u001b]52;c;Zm9v\u0007'
    const { interpreter, updates } = run(sequence)
    const state = interpreter.snapshot

    expect(state.clipboard).toEqual({ selection: 'c', data: 'Zm9v' })
    const flattened = updates.flat()
    const clipboardUpdate = flattened.find(
      (update) => update.type === 'clipboard',
    )
    expect(clipboardUpdate).toBeDefined()
    if (clipboardUpdate && clipboardUpdate.type === 'clipboard') {
      expect(clipboardUpdate.clipboard.data).toBe('Zm9v')
    }
  })

  it('streams DCS payloads through start/data/end updates', () => {
    const payload = 'pixels'
    const { updates } = run(`\u001bPq${payload}\u001b\\`)
    const flattened = updates.flat()

    expect(flattened.some((update) => update.type === 'dcs-start')).toBe(true)
    expect(
      flattened.filter((update) => update.type === 'dcs-data'),
    ).not.toHaveLength(0)
    const end = flattened.find((update) => update.type === 'dcs-end')
    expect(end).toBeDefined()
    if (end && end.type === 'dcs-end') {
      expect(end.data.endsWith(payload)).toBe(true)
    }
  })

  it('records SOS/PM/APC dispatch data', () => {
    const { interpreter, updates } = run('\u001bXstatus\u001b\\')
    const state = interpreter.snapshot

    expect(state.lastSosPmApc).toEqual({ kind: 'SOS', data: 'status' })
    const flattened = updates.flat()
    expect(flattened.some((update) => update.type === 'sos-pm-apc')).toBe(true)
  })

  it('manages selection lifecycle via explicit APIs', () => {
    const interpreter = createInterpreter()
    const initialSelection: TerminalSelection = {
      anchor: { row: 0, column: 0, timestamp: 1 },
      focus: { row: 0, column: 2, timestamp: 2 },
      kind: 'normal',
      status: 'dragging',
    }

    const setUpdates = interpreter.setSelection(initialSelection)
    expect(setUpdates).toEqual([
      { type: 'selection-set', selection: initialSelection },
    ])
    expect(interpreter.snapshot.selection).toEqual(initialSelection)

    const nextSelection: TerminalSelection = {
      anchor: initialSelection.anchor,
      focus: { row: 1, column: 5, timestamp: 3 },
      kind: 'normal',
      status: 'idle',
    }

    const updateUpdates = interpreter.updateSelection(nextSelection)
    expect(updateUpdates).toEqual([
      { type: 'selection-update', selection: nextSelection },
    ])
    expect(interpreter.snapshot.selection).toEqual(nextSelection)

    const redundantUpdates = interpreter.updateSelection(nextSelection)
    expect(redundantUpdates).toEqual([])

    const clear = interpreter.clearSelection()
    expect(clear).toEqual([{ type: 'selection-clear' }])
    expect(interpreter.snapshot.selection).toBeNull()

    const noopClear = interpreter.clearSelection()
    expect(noopClear).toEqual([])
  })

  it('replaces selection within a single row via editSelection', () => {
    const { interpreter } = run('ALPHA BETA')
    const selection: TerminalSelection = {
      anchor: { row: 0, column: 6, timestamp: 1 },
      focus: { row: 0, column: 10, timestamp: 2 },
      kind: 'normal',
      status: 'idle',
    }

    interpreter.setSelection(selection)
    const updates = interpreter.editSelection({
      selection,
      replacement: ' keyboard paste',
    })

    const row0 = interpreter.snapshot.buffer[0]!
    const rendered = row0
      .map((cell) => cell.char)
      .join('')
      .trimEnd()
    expect(rendered).toBe('ALPHA keyboard paste')
    expect(interpreter.snapshot.cursor.row).toBe(0)
    expect(interpreter.snapshot.cursor.column).toBe(
      6 + ' keyboard paste'.length,
    )
    expect(interpreter.snapshot.selection).toBeNull()
    expect(updates.some((update) => update.type === 'selection-clear')).toBe(
      true,
    )
    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    expect(updates.some((update) => update.type === 'cursor')).toBe(true)
  })

  it('supports multi-line replacement with newlines in editSelection', () => {
    const { interpreter } = run('HELLO\nWORLD')
    const selection: TerminalSelection = {
      anchor: { row: 0, column: 0, timestamp: 1 },
      focus: { row: 1, column: 0, timestamp: 2 },
      kind: 'normal',
      status: 'idle',
    }

    interpreter.setSelection(selection)
    interpreter.editSelection({
      selection,
      replacement: 'FOO\nBAR',
    })

    const firstRow = interpreter.snapshot.buffer[0]!
    const secondRow = interpreter.snapshot.buffer[1]!
    expect(
      firstRow
        .slice(0, 3)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('FOO')
    expect(
      secondRow
        .slice(0, 8)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('BARWORLD')
    expect(interpreter.snapshot.cursor.row).toBe(1)
    expect(interpreter.snapshot.cursor.column).toBe(3)
  })

  it('inserts text at the cursor when no selection is active', () => {
    const { interpreter } = run('PROMPT ')
    const updates = interpreter.editSelection({ replacement: 'λ> ' })

    const row = interpreter.snapshot.buffer[0]!
    expect(
      row
        .slice(0, 9)
        .map((cell) => cell.char)
        .join(''),
    ).toBe('PROMPT λ>')
    expect(interpreter.snapshot.cursor.column).toBe(10)
    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    expect(updates.some((update) => update.type === 'cursor')).toBe(true)
  })

  it('moves the cursor left and right while clearing selection', () => {
    const { interpreter } = run('TEST')
    interpreter.moveCursorLineStart()
    interpreter.moveCursorRight()
    interpreter.moveCursorRight()
    const updates = interpreter.moveCursorLeft()
    expect(interpreter.snapshot.cursor.column).toBe(1)
    expect(updates.some((update) => update.type === 'cursor')).toBe(true)
    expect(interpreter.snapshot.selection).toBeNull()
  })

  it('extends selection when moving cursor with Shift', () => {
    const { interpreter } = run('SELECT')
    const anchor = { row: 0, column: 0, timestamp: 1 }
    interpreter.moveCursorLineStart()
    interpreter.moveCursorRight()
    interpreter.moveCursorRight()
    const updates = interpreter.moveCursorRight({
      extendSelection: true,
      selectionAnchor: anchor,
    })
    const selection = interpreter.snapshot.selection
    expect(selection).not.toBeNull()
    expect(selection?.anchor).toEqual(anchor)
    expect(selection?.focus.column).toBe(3)
    expect(updates.some((update) => update.type === 'selection-set')).toBe(true)
  })

  it('moves by word boundaries using word motion helpers', () => {
    const { interpreter } = run('one  two  three')
    interpreter.moveCursorLineStart()
    interpreter.moveCursorWordRight()
    expect(interpreter.snapshot.cursor.column).toBeGreaterThan(3)
    interpreter.moveCursorWordLeft()
    expect(interpreter.snapshot.cursor.column).toBe(0)
  })

  it('moves to the start and end of the current line', () => {
    const { interpreter } = run('line content')
    interpreter.moveCursorLineEnd()
    const endColumn = interpreter.snapshot.cursor.column
    expect(endColumn).toBeGreaterThan(0)
    interpreter.moveCursorLineStart()
    expect(interpreter.snapshot.cursor.column).toBe(0)
  })

  it('renders individual box drawing characters correctly', () => {
    const { interpreter } = run('┏┓\r\n┗┛')
    const state = interpreter.snapshot
    expect(state.buffer[0]![0]!.char.codePointAt(0)).toBe('┏'.codePointAt(0))
    const top = state.buffer[0]!.map((cell) => cell.char)
      .join('')
      .trimEnd()
    const bottom = state.buffer[1]!.map((cell) => cell.char)
      .join('')
      .trimEnd()
    expect(top).toBe('┏┓')
    expect(bottom).toBe('┗┛')
  })

  it('renders complex ANSI banner with truecolor and emojis', () => {
    const sequence =
      '\u001b[38;2;88;166;255m┏━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━┓\r\n' +
      '\u001b[38;2;88;166;255m┃\u001b[0m  \u001b[1;38;2;35;134;54mMana Web Terminal\u001b[0m  \u001b[38;2;88;166;255m┃\r\n' +
      '\u001b[38;2;88;166;255m┣━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━┫\r\n' +
      '\u001b[0m  🛰  \u001b[3mConnected to virtual constellation\u001b[0m\r\n' +
      '  🧪  \u001b[38;2;255;215;0mExperimental session — type freely!\u001b[0m\r\n' +
      '  🌈  \u001b[38;2;180;82;205mANSI colors,\u001b[38;2;97;218;251m truecolor,\u001b[38;2;130;170;255m emoji ✨\u001b[0m\r\n' +
      '  🔁  \u001b[4mEcho is local until you wire a host\u001b[0m\r\n' +
      '  ⌨️  Paste, arrow keys, and Ctrl shortcuts supported\r\n' +
      '\u001b[38;2;88;166;255m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\u001b[0m\r\n\r\n'

    const { interpreter } = run(sequence)
    const state = interpreter.snapshot
    const readRow = (row: number): string =>
      state.buffer[row]!.map((cell) => cell.char)
        .join('')
        .trimEnd()

    expect(readRow(0)).toBe('┏━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━┓')
    expect(readRow(1)).toBe('┃  Mana Web Terminal  ┃')
    expect(readRow(2)).toBe('┣━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━┫')
    expect(readRow(3)).toBe('  🛰  Connected to virtual constellation')
    expect(readRow(4)).toBe('  🧪  Experimental session — type freely!')
    expect(readRow(5)).toBe('  🌈  ANSI colors, truecolor, emoji ✨')
    expect(readRow(6)).toBe('  🔁  Echo is local until you wire a host')
    expect(readRow(7)).toBe(
      '  ⌨️  Paste, arrow keys, and Ctrl shortcuts supported',
    )
    expect(readRow(8)).toBe('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
    expect(readRow(9)).toBe('')
  })

  it('applies the DEC screen alignment pattern', () => {
    const { interpreter } = run('\u001b#8')
    const snapshot = interpreter.snapshot
    expect(snapshot.buffer[0]!.every((cell) => cell.char === 'E')).toBe(true)
    expect(snapshot.cursor).toEqual({ row: 0, column: 0 })
  })

  it('resets the terminal with RIS', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const updates: TerminalUpdate[][] = []
    const sink = new InterpreterSink(interpreter, updates)

    parser.write('\u001b[31;1mX', sink)
    expect(interpreter.snapshot.attributes.foreground).toEqual({
      type: 'ansi',
      index: 1,
    })

    parser.write('\u001bc', sink)
    const snapshot = interpreter.snapshot
    expect(snapshot.cursor).toEqual({ row: 0, column: 0 })
    expect(snapshot.attributes.foreground).toEqual({ type: 'default' })
    expect(snapshot.buffer[0]![0]!.char).toBe(' ')
  })

  it('toggles 132-column mode with DECCOLM', () => {
    const parser = createParser()
    const interpreter = createInterpreter()
    const updates: TerminalUpdate[][] = []
    const sink = new InterpreterSink(interpreter, updates)

    parser.write('\u001b[?3h', sink)
    expect(interpreter.snapshot.columns).toBe(132)
    expect(interpreter.snapshot.buffer[0]!.length).toBe(132)

    parser.write('\u001b[?3l', sink)
    expect(interpreter.snapshot.columns).toBe(80)
    expect(interpreter.snapshot.buffer[0]!.length).toBe(80)
  })
})
class RecordingSink implements ParserEventSink {
  constructor(
    private readonly parser: Parser,
    private readonly interpreter: TerminalInterpreter,
    private readonly updates: TerminalUpdate[][],
  ) {}

  onEvent(event: ParserEvent): void {
    const updates = this.interpreter.handleEvent(event)
    this.updates.push(updates)
    for (const update of updates) {
      if (update.type === 'c1-transmission') {
        this.parser.setC1TransmissionMode(update.value)
      }
    }
  }
}

const createHarness = (options: ParserOptions = { spec: 'vt320' }) => {
  const parser = createParser(options)
  const interpreter = createInterpreter({ parser: options })
  const updates: TerminalUpdate[][] = []
  const sink = new RecordingSink(parser, interpreter, updates)
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
        0x9b, 0x3f, 0x36, 0x32, 0x3b, 0x31, 0x3b, 0x32, 0x3b, 0x36, 0x3b, 0x37,
        0x3b, 0x38, 0x3b, 0x39, 0x63,
      ])
    }

    updates.length = 0
    parser.write('\u001B[>c', sink)
    responses = updates.flat().filter((update) => update.type === 'response')
    expect(responses).toHaveLength(1)
    if (responses[0]?.type === 'response') {
      expect(Array.from(responses[0].data)).toEqual([
        0x9b, 0x3e, 0x36, 0x32, 0x3b, 0x31, 0x3b, 0x32, 0x63,
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
    parser.write(new Uint8Array([0x9b]), sink)
    const printedDuringSevenBit = updates
      .flat()
      .filter((update) => update.type === 'cells')
    expect(printedDuringSevenBit).toHaveLength(0)

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
      expect(Array.from(finalResponses[0].data)).toEqual([
        0x9b, 0x3f, 0x36, 0x32, 0x3b, 0x31, 0x3b, 0x32, 0x3b, 0x36, 0x3b, 0x37,
        0x3b, 0x38, 0x3b, 0x39, 0x63,
      ])
    }

    updates.length = 0
    parser.write(new Uint8Array([0x9b, 0x41]), sink)
    const postRestoreCells = updates
      .flat()
      .filter((update) => update.type === 'cells')
    expect(postRestoreCells).toHaveLength(0)
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
