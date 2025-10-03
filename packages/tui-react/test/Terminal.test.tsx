import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Terminal, type TerminalHandle } from '../src/Terminal'
import {
  createCanvasRenderer,
  type CanvasRendererOptions,
  type CanvasRendererDiagnostics,
} from '@mana/tui-web-canvas-renderer'

vi.mock('@mana/tui-web-canvas-renderer', () => {
  const createCanvasRenderer = vi.fn((options: CanvasRendererOptions) => {
    const renderer: CanvasRendererMock = {
      canvas: options.canvas,
      applyUpdates: vi.fn((updateOptions) => {
        renderer.currentSelection = updateOptions.snapshot.selection ?? null
        renderer.onSelectionChange?.(renderer.currentSelection)
      }),
      resize: vi.fn(),
      setTheme: vi.fn(),
      sync: vi.fn((snapshot) => {
        renderer.currentSelection = snapshot.selection ?? null
        renderer.onSelectionChange?.(renderer.currentSelection)
      }),
      dispose: vi.fn(),
      diagnostics: {
        lastFrameDurationMs: 0,
        lastDrawCallCount: 0,
        gpuFrameDurationMs: null,
        gpuDrawCallCount: null,
        gpuCellsProcessed: null,
        gpuBytesUploaded: null,
        gpuDirtyRegionCoverage: null,
        gpuOverlayBytesUploaded: null,
        gpuRowMetadata: null,
        lastOsc: null,
        lastSosPmApc: null,
        lastDcs: null,
      } satisfies CanvasRendererDiagnostics,
      currentSelection: options.snapshot.selection ?? null,
      onSelectionChange: options.onSelectionChange,
    }

    return renderer
  })

  return {
    createCanvasRenderer,
    detectPreferredBackend: vi.fn(() => ({ type: 'cpu-2d' as const })),
  }
})
import type { TerminalSelection } from '@mana/vt'
import { getSelectionRowSegments } from '@mana/vt'

const encoder = new TextEncoder()

const BASE_STYLING = { rows: 24, columns: 80 } as const

const extractRowText = (
  snapshot: ReturnType<TerminalHandle['getSnapshot']>,
  row = 0,
): string => {
  const rowBuffer = snapshot.buffer[row]
  if (!rowBuffer) {
    return ''
  }
  return rowBuffer.map((cell) => cell.char).join('').trimEnd()
}

const lastRenderer = () =>
  (createCanvasRenderer as unknown as Mock).mock.results.at(-1)!
    .value as CanvasRendererMock

const lastRendererOptions = (): CanvasRendererOptions =>
  ((createCanvasRenderer as unknown as Mock).mock.calls.at(-1)?.[0] ??
    {}) as CanvasRendererOptions

type CanvasRendererMock = ReturnType<typeof createCanvasRenderer> & {
  applyUpdates: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  setTheme: ReturnType<typeof vi.fn>
  sync: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  currentSelection: TerminalSelection | null
  onSelectionChange?: (selection: TerminalSelection | null) => void
}

type PointerCaptureCanvas = HTMLCanvasElement & {
  setPointerCapture: ReturnType<typeof vi.fn>
  releasePointerCapture: ReturnType<typeof vi.fn>
  hasPointerCapture: ReturnType<typeof vi.fn>
}

const installResizeObserverMock = () => {
  const win = window as typeof window & {
    ResizeObserver?: typeof ResizeObserver
  }
  const original = win.ResizeObserver
  let callback: ResizeObserverCallback | null = null
  const observe = vi.fn<(target: Element) => void>()
  const disconnect = vi.fn()
  const instances: ResizeObserver[] = []

  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callback = cb
      instances.push(this as unknown as ResizeObserver)
    }

    observe(target: Element): void {
      observe(target)
    }

    unobserve(): void {}

    disconnect(): void {
      disconnect()
    }
  }

  win.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

  return {
    observe,
    disconnect,
    trigger: (width: number, height: number) => {
      if (!callback) {
        throw new Error('ResizeObserver callback not registered')
      }
      const target = observe.mock.calls[0]?.[0] ?? document.createElement('div')
      callback(
        [
          {
            target,
            contentRect: { width, height },
          } as unknown as ResizeObserverEntry,
        ],
        instances[0]!,
      )
    },
    restore: () => {
      if (original) {
        win.ResizeObserver = original
      } else {
        Reflect.deleteProperty(win, 'ResizeObserver')
      }
    },
  }
}

describe('Terminal', () => {
  test('renders focusable terminal container with canvas', async () => {
    render(
      <Terminal
        accessibility={{ ariaLabel: 'Demo terminal' }}
        styling={{ rows: 24, columns: 80 }}
      />,
    )

    const region = screen.getByRole('textbox', { name: 'Demo terminal' })
    expect(region).toHaveAttribute('tabindex', '0')

    const canvas = region.querySelector('canvas')
    expect(canvas).not.toBeNull()

    await userEvent.click(region)
    expect(region).toHaveFocus()
  })

  test('does not focus itself by default', () => {
    render(
      <Terminal
        accessibility={{ ariaLabel: 'Focus opt-in' }}
        styling={{ rows: 24, columns: 80 }}
      />,
    )

    const region = screen.getByRole('textbox', { name: 'Focus opt-in' })
    expect(region).not.toHaveFocus()
  })

  test('forwards key input via onData and echoes locally by default', async () => {
    const onData = vi.fn()
    render(
      <Terminal
        styling={{ rows: 24, columns: 80 }}
        instrumentation={{ onData }}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('a')

    expect(onData).toHaveBeenCalledWith(encoder.encode('a'))
    const renderer = lastRenderer()
    expect(renderer.applyUpdates).toHaveBeenCalled()
  })

  test('exposes shortcut guide controls via the imperative handle', async () => {
    const ref = createRef<TerminalHandle>()
    const onShortcutGuideToggle = vi.fn()

    render(
      <Terminal
        ref={ref}
        accessibility={{ ariaLabel: 'Shortcut host' }}
        styling={BASE_STYLING}
        onShortcutGuideToggle={onShortcutGuideToggle}
      />,
    )

    expect(ref.current).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: /terminal shortcuts/i })).toBeNull()

    await act(async () => {
      ref.current!.openShortcutGuide()
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /terminal shortcuts/i })).toBeVisible()
    })

    expect(onShortcutGuideToggle).toHaveBeenCalledWith(true, 'imperative')

    await act(async () => {
      ref.current!.closeShortcutGuide()
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /terminal shortcuts/i })).toBeNull()
    })

    expect(onShortcutGuideToggle).toHaveBeenCalledWith(false, 'imperative')
  })

  test('Shift + ? toggles the shortcut guide without emitting data', async () => {
    const onShortcutGuideToggle = vi.fn()
    const onData = vi.fn()

    render(
      <Terminal
        accessibility={{ ariaLabel: 'Shortcut hotkey' }}
        styling={BASE_STYLING}
        instrumentation={{ onData }}
        onShortcutGuideToggle={onShortcutGuideToggle}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)

    await userEvent.keyboard('?')

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /terminal shortcuts/i })).toBeVisible()
    })

    expect(onShortcutGuideToggle).toHaveBeenCalledWith(true, 'hotkey')
    expect(onData).not.toHaveBeenCalled()

    await userEvent.keyboard('?')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /terminal shortcuts/i })).toBeNull()
    })

    expect(onShortcutGuideToggle).toHaveBeenCalledWith(false, 'hotkey')
  })

  test('supports imperative write and reset APIs', async () => {
    const ref = createRef<TerminalHandle>()

    render(<Terminal ref={ref} styling={BASE_STYLING} />)

    expect(ref.current).not.toBeNull()

    await act(async () => {
      ref.current!.write('hello')
    })

    const renderer = lastRenderer()
    expect(renderer.applyUpdates).toHaveBeenCalled()

    await act(async () => {
      ref.current!.reset()
    })

    expect(renderer.sync).toHaveBeenCalled()
  })

  test('disables local echo when requested', async () => {
    const onData = vi.fn()
    render(
      <Terminal
        styling={{ ...BASE_STYLING, localEcho: false }}
        instrumentation={{ onData }}
      />,
    )
    const region = screen.getByRole('textbox')

    const renderer = lastRenderer()
    const initialCalls = renderer.applyUpdates.mock.calls.length

    await userEvent.click(region)
    await userEvent.keyboard('z')

    expect(onData).toHaveBeenCalled()
    expect(renderer.applyUpdates.mock.calls.length).toBe(initialCalls)
  })

  test('extends selections with Shift + Arrow keys', async () => {
    const ref = createRef<TerminalHandle>()
    render(<Terminal ref={ref} styling={BASE_STYLING} />)

    const region = screen.getByRole('textbox')
    await userEvent.click(region)

    await act(async () => {
      ref.current!.write('ALPHA BETA')
    })

    for (let index = 0; index < 4; index += 1) {
      fireEvent.keyDown(region, { key: 'ArrowLeft', shiftKey: true })
    }

    const selection = ref.current!.getSelection()
    expect(selection).not.toBeNull()

    const snapshot = ref.current!.getSnapshot()
    const segments = getSelectionRowSegments(selection!, snapshot.columns)
    const text = segments
      .map((segment) => {
        const rowCells = snapshot.buffer[segment.row] ?? []
        let line = ''
        for (
          let column = segment.startColumn;
          column <= segment.endColumn;
          column += 1
        ) {
          line += rowCells[column]?.char ?? ' '
        }
        return line
      })
      .join('\n')
      .trim()

    expect(text).toBe('BETA')
  })

  test('commits IME composition sequences before emitting data', async () => {
    const ref = createRef<TerminalHandle>()
    const onData = vi.fn()

    render(
      <Terminal
        ref={ref}
        styling={BASE_STYLING}
        instrumentation={{ onData }}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)

    await act(async () => {
      fireEvent.compositionStart(region, { data: '' })
      fireEvent.compositionUpdate(region, { data: 'あ' })
      fireEvent.keyDown(region, { key: 'Process' })
    })

    expect(onData).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.compositionEnd(region, { data: 'あ' })
    })

    await waitFor(() => {
      expect(onData).toHaveBeenCalledWith(encoder.encode('あ'))
    })

    const snapshot = ref.current!.getSnapshot()
    expect(extractRowText(snapshot)).toBe('あ')
  })

  test('falls back to local newline when no onData handler is provided', async () => {
    const ref = createRef<TerminalHandle>()
    render(<Terminal ref={ref} styling={BASE_STYLING} />)
    const region = screen.getByRole('textbox')
    const renderer = lastRenderer()

    await userEvent.click(region)
    await userEvent.keyboard('A')

    renderer.applyUpdates.mockClear()

    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('B')

    const snapshot = ref.current!.getSnapshot()
    const row1 = snapshot.buffer[1] ?? []
    const char = row1[0]?.char ?? ' '
    expect(char).toBe('B')
  })

  test('exposes snapshot via imperative handle', async () => {
    const ref = createRef<TerminalHandle>()
    render(<Terminal ref={ref} styling={BASE_STYLING} />)

    await act(async () => {
      ref.current!.write('hi')
    })

    const snapshot = ref.current!.getSnapshot()
    const row = snapshot.buffer[0] ?? []
    const text = row.slice(0, 2).map((cell) => cell.char).join('')
    expect(text).toBe('hi')
  })

  test('autoResize adjusts rows and columns to fit the container', () => {
    const ro = installResizeObserverMock()
    const ref = createRef<TerminalHandle>()

    try {
      render(
        <Terminal
          ref={ref}
          styling={{ metrics: { cell: { width: 5, height: 10 } } }}
        />,
      )

      expect(ro.observe).toHaveBeenCalledTimes(1)

      act(() => {
        ro.trigger(5 * 12, 10 * 6)
      })

      const snapshot = ref.current!.getSnapshot()
      expect(snapshot.columns).toBe(12)
      expect(snapshot.rows).toBe(6)
    } finally {
      ro.restore()
    }
  })

  test('disabling autoResize prevents ResizeObserver usage and preserves dimensions', () => {
    const ro = installResizeObserverMock()
    const ref = createRef<TerminalHandle>()

    try {
      render(
        <Terminal
          ref={ref}
          styling={{ rows: 30, columns: 100, autoResize: false }}
        />,
      )

      expect(ro.observe).not.toHaveBeenCalled()

      const snapshot = ref.current!.getSnapshot()
      expect(snapshot.rows).toBe(30)
      expect(snapshot.columns).toBe(100)
    } finally {
      ro.restore()
    }
  })

  test('exposes cursor selection updates via pointer interaction and handle', async () => {
    vi.useFakeTimers()
    const onCursorSelectionChange = vi.fn()
    const ref = createRef<TerminalHandle>()

    render(
      <Terminal
        ref={ref}
        styling={BASE_STYLING}
        instrumentation={{ onCursorSelectionChange }}
      />,
    )

    const region = screen.getByRole('textbox')
    const canvas = region.querySelector('canvas') as HTMLCanvasElement
    expect(canvas).not.toBeNull()

    const pointerCanvas = canvas as PointerCaptureCanvas
    pointerCanvas.setPointerCapture = vi.fn()
    pointerCanvas.releasePointerCapture = vi.fn()
    pointerCanvas.hasPointerCapture = vi.fn(() => true)
    const rectSpy = vi
      .spyOn(canvas, 'getBoundingClientRect')
      .mockReturnValue({
        left: 0,
        top: 0,
        right: 90,
        bottom: 180,
        width: 90,
        height: 180,
        x: 0,
        y: 0,
        toJSON: () => {},
      } as DOMRect)

    try {
      await act(async () => {
        fireEvent.pointerDown(canvas, {
          button: 0,
          pointerId: 1,
          clientX: 5,
          clientY: 5,
        })
      })

      await act(async () => {
        fireEvent.pointerMove(canvas, {
          pointerId: 1,
          clientX: 25,
          clientY: 25,
        })
      })

      await act(async () => {
        fireEvent.pointerMove(canvas, {
          pointerId: 1,
          clientX: 25,
          clientY: 250,
        })
      })

      act(() => {
        vi.advanceTimersByTime(200)
      })

      const selection = ref.current?.getSelection()
      expect(selection).not.toBeNull()
      if (selection) {
        expect(selection.anchor.row).toBe(0)
        expect(selection.focus.row).toBeGreaterThan(selection.anchor.row)
      }

      await act(async () => {
        fireEvent.pointerMove(canvas, {
          pointerId: 1,
          clientX: 25,
          clientY: 25,
        })
      })

      await act(async () => {
        fireEvent.pointerUp(canvas, {
          pointerId: 1,
          clientX: 25,
          clientY: 25,
        })
      })

      const callbackSelection = onCursorSelectionChange.mock.lastCall?.[0] ?? null
      expect(callbackSelection).toEqual(ref.current?.getSelection())
    } finally {
      rectSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  test('provides a default selection theme to the renderer', () => {
    render(<Terminal styling={BASE_STYLING} />)
    const options = lastRendererOptions()
    expect(options.theme.selection).toEqual({
      background: '#264f78',
      foreground: '#ffffff',
    })
  })

  test('allows overriding the selection theme via props', () => {
    render(
      <Terminal
        styling={{
          ...BASE_STYLING,
          theme: {
            selection: { background: '#123456', foreground: '#fedcba' },
          },
        }}
      />,
    )
    const options = lastRendererOptions()
    expect(options.theme.selection).toEqual({
      background: '#123456',
      foreground: '#fedcba',
    })
  })

  test('forwards cursor overlay strategy to the canvas renderer', () => {
    const cursorOverlayStrategy = vi.fn()
    render(
      <Terminal
        styling={BASE_STYLING}
        graphics={{ cursorOverlayStrategy }}
      />,
    )
    const options = lastRendererOptions()
    expect(options.cursorOverlayStrategy).toBe(cursorOverlayStrategy)
  })

  test('moves the cursor locally when pressing arrow keys', async () => {
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={{ ...BASE_STYLING, localEcho: false }}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => {
      expect(ref.current?.getSnapshot().cursor.column).toBe(1)
    })
  })

  test('extends selection with Shift + Arrow', async () => {
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={{ ...BASE_STYLING, localEcho: false }}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')

    await waitFor(() => {
      const selection = ref.current?.getSelection()
      expect(selection).not.toBeNull()
      expect(selection?.anchor.column).toBe(1)
      expect(selection?.focus.column).toBe(2)
    })
  })

  test('supports option/alt word jumps and meta line jumps', async () => {
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={{ ...BASE_STYLING, localEcho: false }}
      />,
    )

    await act(async () => {
      ref.current?.write('one  two  three')
    })

    const region = screen.getByRole('textbox')
    await userEvent.click(region)

    fireEvent.keyDown(region, { key: 'ArrowLeft', metaKey: true })
    fireEvent.keyUp(region, { key: 'ArrowLeft', metaKey: true })
    expect(ref.current?.getSnapshot().cursor.column).toBe(0)

    fireEvent.keyDown(region, { key: 'ArrowRight', altKey: true })
    fireEvent.keyUp(region, { key: 'ArrowRight', altKey: true })
    expect(ref.current?.getSnapshot().cursor.column).toBeGreaterThan(0)
  })

  test('backspace edits locally while emitting DEL', async () => {
    const onData = vi.fn()
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={{ ...BASE_STYLING, localEcho: true }}
        instrumentation={{ onData }}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('AB')

    onData.mockClear()
    await userEvent.keyboard('{Backspace}')

    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith(new Uint8Array([0x7f]))

    const snapshot = ref.current!.getSnapshot()
    expect(extractRowText(snapshot)).toBe('A')
  })

  test('raw DEL input leaves the buffer untouched', async () => {
    const ref = createRef<TerminalHandle>()
    render(<Terminal ref={ref} styling={BASE_STYLING} />)

    expect(ref.current).not.toBeNull()

    await act(async () => {
      ref.current!.write('DELTEST')
    })

    await act(async () => {
      ref.current!.write(new Uint8Array([0x7f]))
    })

    const snapshot = ref.current!.getSnapshot()
    expect(extractRowText(snapshot)).toBe('DELTEST')
  })

  test('delete key removes the character ahead of the cursor locally', async () => {
    const onData = vi.fn()
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={{ ...BASE_STYLING, localEcho: true }}
        instrumentation={{ onData }}
      />,
    )

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('ABCD')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')

    onData.mockClear()
    await userEvent.keyboard('{Delete}')

    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith(encoder.encode('\u001b[3~'))

    const snapshot = ref.current!.getSnapshot()
    expect(extractRowText(snapshot)).toBe('ABD')
  })

  test('announceStatus surfaces messages via live region', async () => {
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={BASE_STYLING}
        accessibility={{ autoFocus: false }}
      />,
    )

    expect(ref.current).not.toBeNull()

    await act(async () => {
      ref.current!.announceStatus({
        kind: 'connection',
        level: 'error',
        message: 'Connection lost',
      })
    })

    const statusRegion = await screen.findByTestId('terminal-status-region')
    await waitFor(() => {
      expect(statusRegion).toHaveTextContent('Connection lost')
      expect(statusRegion).toHaveAttribute('aria-live', 'assertive')
    })
  })

  test('single click collapses selection and moves cursor', async () => {
    const ref = createRef<TerminalHandle>()
    render(
      <Terminal
        ref={ref}
        styling={{ ...BASE_STYLING, localEcho: false }}
      />,
    )

    await act(async () => {
      ref.current?.write('hello')
    })

    const region = screen.getByRole('textbox')
    const canvas = region.querySelector('canvas') as HTMLCanvasElement
    await userEvent.click(region)

    const rectSpy = vi
      .spyOn(canvas, 'getBoundingClientRect')
      .mockReturnValue({
        left: 0,
        top: 0,
        right: 90,
        bottom: 180,
        width: 90,
        height: 180,
        x: 0,
        y: 0,
        toJSON: () => {},
      } as DOMRect)

    try {
      const pointerCanvas = canvas as PointerCaptureCanvas
      pointerCanvas.setPointerCapture = vi.fn()
      pointerCanvas.releasePointerCapture = vi.fn()
      pointerCanvas.hasPointerCapture = vi.fn(() => true)

      fireEvent.pointerDown(canvas, {
        button: 0,
        pointerId: 1,
        clientX: 500,
        clientY: 10,
      })

      fireEvent.pointerUp(canvas, {
        button: 0,
        pointerId: 1,
        clientX: 500,
        clientY: 10,
      })

      const snapshot = ref.current?.getSnapshot()
      expect(snapshot?.selection).toBeNull()
      expect(snapshot?.cursor.column).toBe(5)
    } finally {
      rectSpy.mockRestore()
    }
  })

  test('emits frame diagnostics via instrumentation onFrame', async () => {
    const onFrame = vi.fn()
    const ref = createRef<TerminalHandle>()

    render(
      <Terminal
        ref={ref}
        accessibility={{ ariaLabel: 'Frame terminal' }}
        styling={{ rows: 3, columns: 3 }}
        instrumentation={{ onFrame }}
      />,
    )

    await waitFor(() => {
      expect(onFrame).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'initial-sync' }),
      )
    })

    onFrame.mockClear()

    act(() => {
      ref.current?.write('hi')
    })

    await waitFor(() => {
      expect(onFrame).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'apply-updates' }),
      )
    })
  })

})
