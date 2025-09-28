import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Terminal, type TerminalHandle } from '../src/Terminal'
import { createCanvasRenderer } from '@mana-ssh/tui-web-canvas-renderer'

const encoder = new TextEncoder()

const lastRenderer = () =>
  (createCanvasRenderer as unknown as Mock).mock.results.at(-1)!
    .value as CanvasRendererMock

type CanvasRendererMock = ReturnType<typeof createCanvasRenderer> & {
  applyUpdates: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  setTheme: ReturnType<typeof vi.fn>
  sync: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const installResizeObserverMock = () => {
  const original = (window as any).ResizeObserver
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

  ;(window as any).ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

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
      ;(window as any).ResizeObserver = original
    },
  }
}

describe('Terminal', () => {
  test('renders focusable terminal container with canvas', async () => {
    render(<Terminal ariaLabel="Demo terminal" rows={24} columns={80} />)

    const region = screen.getByRole('textbox', { name: 'Demo terminal' })
    expect(region).toHaveAttribute('tabindex', '0')

    const canvas = region.querySelector('canvas')
    expect(canvas).not.toBeNull()

    await userEvent.click(region)
    expect(region).toHaveFocus()
  })

  test('forwards key input via onData and echoes locally by default', async () => {
    const onData = vi.fn()
    render(<Terminal onData={onData} rows={24} columns={80} />)

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('a')

    expect(onData).toHaveBeenCalledWith(encoder.encode('a'))
    const renderer = lastRenderer()
    expect(renderer.applyUpdates).toHaveBeenCalled()
  })

  test('supports imperative write and reset APIs', async () => {
    const ref = createRef<TerminalHandle>()

    render(<Terminal ref={ref} rows={24} columns={80} />)

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
    render(<Terminal onData={onData} localEcho={false} rows={24} columns={80} />)
    const region = screen.getByRole('textbox')

    const renderer = lastRenderer()
    const initialCalls = renderer.applyUpdates.mock.calls.length

    await userEvent.click(region)
    await userEvent.keyboard('z')

    expect(onData).toHaveBeenCalled()
    expect(renderer.applyUpdates.mock.calls.length).toBe(initialCalls)
  })

  test('falls back to local newline when no onData handler is provided', async () => {
    const ref = createRef<TerminalHandle>()
    render(<Terminal ref={ref} rows={24} columns={80} />)
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
    render(<Terminal ref={ref} rows={24} columns={80} />)

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
          metrics={{ cell: { width: 5, height: 10 } }}
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
      render(<Terminal ref={ref} rows={30} columns={100} autoResize={false} />)

      expect(ro.observe).not.toHaveBeenCalled()

      const snapshot = ref.current!.getSnapshot()
      expect(snapshot.rows).toBe(30)
      expect(snapshot.columns).toBe(100)
    } finally {
      ro.restore()
    }
  })
})
