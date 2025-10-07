import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionPoint, TerminalSelection } from '@mana/vt'
import type { RendererSession } from '@mana/webgl-renderer'
import type { HotkeyContext } from './context'
import { handleTerminalHotkey } from './handler'

type TerminalHotkeyEvent = Parameters<typeof handleTerminalHotkey>[0]

const createKeyboardEvent = (
  options: Partial<{
    key: string
    code: string
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    composing: boolean
  }> = {},
): TerminalHotkeyEvent => {
  const {
    key = 'a',
    code = key.length === 1 ? `Key${key.toUpperCase()}` : key,
    shiftKey = false,
    ctrlKey = false,
    metaKey = false,
    altKey = false,
    composing = false,
  } = options

  return {
    key,
    code,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    nativeEvent: { isComposing: composing },
    preventDefault: vi.fn(),
  } as unknown as TerminalHotkeyEvent
}

interface MockContext {
  readonly context: HotkeyContext
  readonly snapshot: any
  readonly performLocalErase: ReturnType<typeof vi.fn>
  readonly clearSelection: ReturnType<typeof vi.fn>
  readonly toggleShortcutGuide: ReturnType<typeof vi.fn>
}

const createContext = (): MockContext => {
  const snapshot = {
    cursor: { row: 5, column: 12 },
    selection: null,
  } as any

  const performLocalErase = vi.fn(() => false)
  const clearSelection = vi.fn()
  const toggleShortcutGuide = vi.fn()

  const context: HotkeyContext = {
    runtime: { snapshot } as RendererSession['runtime'],
    performLocalErase,
    clearSelection,
    shortcutGuideEnabled: false,
    toggleShortcutGuide,
    compositionStateRef: { current: { active: false, data: '' } },
    keyboardSelectionAnchorRef: { current: null },
  }

  return { context, snapshot, performLocalErase, clearSelection, toggleShortcutGuide }
}

describe('handleTerminalHotkey', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('returns noop while composing', () => {
    const { context } = createContext()
    context.compositionStateRef.current.active = true
    const event = createKeyboardEvent({ key: 'a' })

    const result = handleTerminalHotkey(event, context)

    expect(result.handled).toBe(false)
  })

  it('toggles shortcut guide on Shift + ?', () => {
    const { context, toggleShortcutGuide } = createContext()
    const hotkeyContext: HotkeyContext = {
      ...context,
      shortcutGuideEnabled: true,
    }
    const event = createKeyboardEvent({ key: '?', code: 'Slash', shiftKey: true })

    const result = handleTerminalHotkey(event, hotkeyContext)

    expect(result.handled).toBe(true)
    expect(result.rendererEvents).toBeUndefined()
    expect(result.preventDefault).toBe(true)
    expect(toggleShortcutGuide).toHaveBeenCalledWith('hotkey')
  })

  it('passes through browser copy shortcuts', () => {
    const { context } = createContext()
    const event = createKeyboardEvent({ key: 'c', metaKey: true })

    const result = handleTerminalHotkey(event, context)

    expect(result.handled).toBe(false)
  })

  it('returns renderer key event for Enter and clears selection', () => {
    const { context, snapshot, clearSelection } = createContext()
    snapshot.selection = {
      anchor: { row: 1, column: 1, timestamp: Date.now() },
      focus: { row: 1, column: 2, timestamp: Date.now() },
      kind: 'normal',
      status: 'idle',
    } as unknown as TerminalSelection

    const event = createKeyboardEvent({ key: 'Enter' })
    const result = handleTerminalHotkey(event, context)

    expect(result.handled).toBe(true)
    expect(result.preventDefault).toBe(true)
    expect(result.rendererEvents).toEqual([
      expect.objectContaining({ type: 'runtime.key', key: 'Enter' }),
    ])
    expect(clearSelection).toHaveBeenCalled()
    expect(context.keyboardSelectionAnchorRef.current).toBeNull()
  })

  it('performs local erase when possible', () => {
    const { context, performLocalErase } = createContext()
    performLocalErase.mockReturnValue(true)
    const event = createKeyboardEvent({ key: 'Backspace', code: 'Backspace' })

    const result = handleTerminalHotkey(event, context)

    expect(result.handled).toBe(true)
    expect(result.preventDefault).toBe(true)
    expect(result.skipLocalEcho).toBe(true)
    expect(result.rendererEvents).toEqual([
      expect.objectContaining({ type: 'runtime.key', key: 'Backspace' }),
    ])
  })

  it('extends selection anchor on shift + arrow', () => {
    const { context, snapshot } = createContext()
    snapshot.cursor = { row: 3, column: 4 } as any
    const event = createKeyboardEvent({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })

    const result = handleTerminalHotkey(event, context)

    expect(result.handled).toBe(true)
    expect(result.preventDefault).toBe(true)
    expect(result.rendererEvents).toEqual([
      expect.objectContaining({
        type: 'runtime.cursor.move',
        direction: 'left',
        options: expect.objectContaining({ extendSelection: true }),
      }),
    ])
    expect(context.keyboardSelectionAnchorRef.current).toEqual(
      expect.objectContaining({ row: 3, column: 4 }),
    )
  })

  it('clears selection when arrow key without shift', () => {
    const { context, snapshot, clearSelection } = createContext()
    snapshot.selection = {
      anchor: { row: 0, column: 0, timestamp: 1 },
      focus: { row: 0, column: 1, timestamp: 2 },
      kind: 'normal',
      status: 'dragging',
    } as unknown as TerminalSelection
    context.keyboardSelectionAnchorRef.current = {
      row: 1,
      column: 1,
      timestamp: 10,
    } as SelectionPoint

    const event = createKeyboardEvent({ key: 'ArrowRight', code: 'ArrowRight' })

    const result = handleTerminalHotkey(event, context)

    expect(result.handled).toBe(true)
    expect(result.preventDefault).toBe(true)
    expect(result.rendererEvents).toEqual([
      expect.objectContaining({
        type: 'runtime.cursor.move',
        direction: 'right',
        options: expect.objectContaining({ extendSelection: false }),
      }),
    ])
    expect(clearSelection).toHaveBeenCalled()
    expect(context.keyboardSelectionAnchorRef.current).toBeNull()
  })
})
