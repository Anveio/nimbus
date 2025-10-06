import { describe, expect, it } from 'vitest'
import type { TerminalSelection, TerminalUpdate } from './interpreter'
import {
  createTerminalRuntime,
  type TerminalRuntimeCursorMoveOptions,
} from './runtime'
import { ParserEventType } from './types'

const createSelectionPoint = (row: number, column: number, seed = 0) => ({
  row,
  column,
  timestamp: 1_000 + seed,
})

const createSelection = (
  row: number,
  startColumn: number,
  endColumn: number,
): TerminalSelection => ({
  anchor: createSelectionPoint(row, startColumn, 0),
  focus: createSelectionPoint(row, endColumn, 1),
  kind: 'normal',
  status: 'idle',
})

const normaliseResponse = (data: Uint8Array): string =>
  Array.from(data)
    .map((byte) => (byte === 0x9b ? '\u001B[' : String.fromCharCode(byte)))
    .join('')

const isResponseUpdate = (
  update: TerminalUpdate,
): update is Extract<TerminalUpdate, { type: 'response' }> =>
  update.type === 'response'

describe('TerminalRuntime host events', () => {
  it('moves the cursor via cursor.move events', () => {
    const runtime = createTerminalRuntime()
    runtime.write('hello')

    const updates = runtime.dispatchEvent({
      type: 'cursor.move',
      direction: 'left',
    })

    expect(updates.some((update) => update.type === 'cursor')).toBe(true)
    expect(runtime.snapshot.cursor.column).toBe(4)
  })

  it('sets the cursor via cursor.set events', () => {
    const runtime = createTerminalRuntime()
    runtime.write('hello')

    const updates = runtime.dispatchEvent({
      type: 'cursor.set',
      position: { row: 0, column: 1 },
    })

    expect(updates.some((update) => update.type === 'cursor')).toBe(true)
    expect(runtime.snapshot.cursor.column).toBe(1)
  })

  it('respects cursor move options when extending selections', () => {
    const runtime = createTerminalRuntime()
    runtime.write('hello')

    const options: TerminalRuntimeCursorMoveOptions = {
      extendSelection: true,
      selectionAnchor: createSelectionPoint(0, 5, 2),
    }

    const updates = runtime.dispatchEvent({
      type: 'cursor.move',
      direction: 'left',
      options,
    })

    expect(updates.some((update) => update.type === 'selection-set')).toBe(true)
    expect(runtime.snapshot.selection).not.toBeNull()
  })

  it('applies selection events', () => {
    const runtime = createTerminalRuntime()
    const selection = createSelection(0, 0, 3)

    const setUpdates = runtime.dispatchEvent({
      type: 'selection.set',
      selection,
    })

    expect(setUpdates.some((update) => update.type === 'selection-set')).toBe(
      true,
    )
    expect(runtime.snapshot.selection).toEqual(selection)

    const updatedSelection: TerminalSelection = {
      ...selection,
      focus: createSelectionPoint(0, 4, 3),
    }

    const updateUpdates = runtime.dispatchEvent({
      type: 'selection.update',
      selection: updatedSelection,
    })

    expect(
      updateUpdates.some((update) => update.type === 'selection-update'),
    ).toBe(true)
    expect(runtime.snapshot.selection).toEqual(updatedSelection)

    const clearUpdates = runtime.dispatchEvent({ type: 'selection.clear' })
    expect(
      clearUpdates.some((update) => update.type === 'selection-clear'),
    ).toBe(true)
    expect(runtime.snapshot.selection).toBeNull()
  })

  it('replaces selection contents via selection.replace', () => {
    const runtime = createTerminalRuntime()
    runtime.write('hello')
    const selection = createSelection(0, 0, 2)

    runtime.dispatchEvent({ type: 'selection.set', selection })

    const updates = runtime.dispatchEvent({
      type: 'selection.replace',
      selection,
      replacement: 'yo',
    })

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    const text = runtime.snapshot.buffer[0]!.slice(0, 4)
      .map((cell) => cell.char)
      .join('')
    expect(text.startsWith('yo')).toBe(true)
  })

  it('dispatches parser events via host event passthrough', () => {
    const runtime = createTerminalRuntime()

    const data = new TextEncoder().encode('A')
    const updates = runtime.dispatchEvent({
      type: 'parser.dispatch',
      event: { type: ParserEventType.Print, data },
    })

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    expect(runtime.snapshot.buffer[0]![0]!.char).toBe('A')
  })

  it('dispatches batches of parser events via host events', () => {
    const runtime = createTerminalRuntime()
    const data = new TextEncoder().encode('BC')

    const updates = runtime.dispatchEvent({
      type: 'parser.batch',
      events: [
        { type: ParserEventType.Print, data: data.subarray(0, 1) },
        { type: ParserEventType.Print, data: data.subarray(1) },
      ],
    })

    expect(
      updates.filter((update) => update.type === 'cells').length,
    ).toBeGreaterThan(0)
    const text = runtime.snapshot.buffer[0]!.slice(0, 2)
      .map((cell) => cell.char)
      .join('')
    expect(text).toBe('BC')
  })

  it('dispatches multiple host events via dispatchEvents', () => {
    const runtime = createTerminalRuntime()
    runtime.write('abc')

    const updates = runtime.dispatchEvents([
      {
        type: 'cursor.set',
        position: { row: 0, column: 1 },
      },
      {
        type: 'selection.set',
        selection: createSelection(0, 0, 1),
      },
    ])

    expect(updates.length).toBeGreaterThan(0)
    expect(runtime.snapshot.cursor.column).toBe(1)
    expect(runtime.snapshot.selection).not.toBeNull()
  })

  it('emits SGR mouse reports when pointer tracking is enabled', () => {
    const runtime = createTerminalRuntime()
    runtime.write('\u001B[?1000h\u001B[?1006h')

    const updates = runtime.dispatchEvent({
      type: 'pointer',
      action: 'down',
      button: 'left',
      buttons: 1,
      position: { row: 5, column: 10 },
    })

    const response = updates.find(isResponseUpdate)
    expect(response).toBeDefined()
    if (response?.type === 'response') {
      expect(normaliseResponse(response.data)).toBe('\u001B[<0;10;5M')
    }
  })

  it('emits wheel reports respecting modifier masks', () => {
    const runtime = createTerminalRuntime()
    runtime.write('\u001B[?1000h\u001B[?1006h')

    const updates = runtime.dispatchEvent({
      type: 'wheel',
      deltaY: -1,
      deltaX: 0,
      position: { row: 3, column: 2 },
      modifiers: { ctrl: true },
    })

    const response = updates.find(isResponseUpdate)
    expect(response).toBeDefined()
    if (response?.type === 'response') {
      expect(normaliseResponse(response.data)).toBe('\u001B[<80;2;3M')
    }
  })

  it('emits focus reports when the mode is enabled', () => {
    const runtime = createTerminalRuntime()
    runtime.write('\u001B[?1004h')

    const focusUpdates = runtime.dispatchEvent({ type: 'focus' })
    const focusResponse = focusUpdates.find(isResponseUpdate)
    expect(focusResponse).toBeDefined()
    if (focusResponse?.type === 'response') {
      expect(normaliseResponse(focusResponse.data)).toBe('\u001B[I')
    }

    const blurUpdates = runtime.dispatchEvent({ type: 'blur' })
    const blurResponse = blurUpdates.find(isResponseUpdate)
    expect(blurResponse).toBeDefined()
    if (blurResponse?.type === 'response') {
      expect(normaliseResponse(blurResponse.data)).toBe('\u001B[O')
    }
  })

  it('wraps paste payloads with bracketed paste guards when enabled', () => {
    const runtime = createTerminalRuntime()
    runtime.write('\u001B[?2004h')

    const updates = runtime.dispatchEvent({ type: 'paste', data: 'abc' })
    const responses = updates
      .filter(isResponseUpdate)
      .map((update) => normaliseResponse(update.data))

    expect(responses).toContain('\u001B[200~')
    expect(responses).toContain('\u001B[201~')
    const text = runtime.snapshot.buffer[0]!
      .slice(0, 3)
      .map((cell) => cell.char)
      .join('')
    expect(text).toBe('abc')
  })

  it('omits bracketed paste guards when mode is disabled', () => {
    const runtime = createTerminalRuntime()

    const updates = runtime.dispatchEvent({ type: 'paste', data: 'xyz' })
    expect(updates.some((update) => update.type === 'response')).toBe(false)
    const text = runtime.snapshot.buffer[0]!
      .slice(0, 3)
      .map((cell) => cell.char)
      .join('')
    expect(text).toBe('xyz')
  })
})

describe('TerminalRuntime parser helpers', () => {
  it('dispatches single parser events', () => {
    const runtime = createTerminalRuntime()
    const data = new TextEncoder().encode('Z')

    const updates = runtime.dispatchParserEvent({
      type: ParserEventType.Print,
      data,
    })

    expect(updates.some((update) => update.type === 'cells')).toBe(true)
    expect(runtime.snapshot.buffer[0]![0]!.char).toBe('Z')
  })

  it('dispatches multiple parser events', () => {
    const runtime = createTerminalRuntime()
    const data = new TextEncoder().encode('XY')

    const updates = runtime.dispatchParserEvents([
      { type: ParserEventType.Print, data: data.subarray(0, 1) },
      { type: ParserEventType.Print, data: data.subarray(1) },
    ])

    expect(
      updates.filter((update) => update.type === 'cells').length,
    ).toBeGreaterThan(0)
    const text = runtime.snapshot.buffer[0]!.slice(0, 2)
      .map((cell) => cell.char)
      .join('')
    expect(text).toBe('XY')
  })
})
