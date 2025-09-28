import { render, act } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  CanvasRenderer,
  CanvasRendererResizeOptions,
  CanvasRendererUpdateOptions,
  CreateCanvasRenderer,
  RendererMetrics,
  RendererTheme,
} from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalState, TerminalUpdate } from '@mana-ssh/vt'
import { TerminalCanvas, type TerminalCanvasHandle } from '../src/TerminalCanvas'

const createSnapshot = (rows = 2, columns = 2): TerminalState => ({
  rows,
  columns,
  cursor: { row: 0, column: 0 },
  scrollTop: 0,
  scrollBottom: rows - 1,
  buffer: Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({
      char: ' ',
      attr: { bold: false, fg: null, bg: null },
    })),
  ),
  attributes: { bold: false, fg: null, bg: null },
  tabStops: new Set<number>(),
  autoWrap: true,
  originMode: false,
  cursorVisible: true,
  savedCursor: null,
  savedAttributes: null,
})

const createMetrics = (): RendererMetrics => ({
  devicePixelRatio: 1,
  font: {
    family: 'monospace',
    size: 14,
    letterSpacing: 0,
    lineHeight: 1,
  },
  cell: {
    width: 12,
    height: 24,
    baseline: 18,
  },
})

const createTheme = (): RendererTheme => ({
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: { color: '#ff00ff', opacity: 1, shape: 'block' },
  palette: {
    ansi: Array.from({ length: 16 }, (_, index) => `#${index.toString(16).repeat(6)}`),
  },
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TerminalCanvas', () => {
  test('instantiates renderer on mount and disposes on unmount', () => {
    const renderer = createRendererSpies()
    const factory = vi.fn<CreateCanvasRenderer>(() => renderer)
    const metrics = createMetrics()
    const snapshot = createSnapshot()
    const theme = createTheme()

    const { unmount } = render(
      <TerminalCanvas renderer={factory} metrics={metrics} theme={theme} snapshot={snapshot} />,
    )

    expect(factory).toHaveBeenCalledTimes(1)
    const factoryOptions = factory.mock.calls[0]![0]!
    expect(factoryOptions.canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(factoryOptions.metrics).toBe(metrics)
    expect(factoryOptions.theme).toBe(theme)
    expect(factoryOptions.snapshot).toBe(snapshot)

    expect(renderer.setTheme).toHaveBeenCalledWith(theme)
    expect(renderer.resize).toHaveBeenCalledWith({ metrics, snapshot })
    expect(renderer.sync).toHaveBeenCalledWith(snapshot)

    unmount()
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })

  test('propagates theme and metrics updates to renderer', () => {
    const renderer = createRendererSpies()
    const factory = vi.fn<CreateCanvasRenderer>(() => renderer)
    const metrics = createMetrics()
    const snapshot = createSnapshot()
    const theme = createTheme()

    const { rerender } = render(
      <TerminalCanvas renderer={factory} metrics={metrics} theme={theme} snapshot={snapshot} />,
    )

    renderer.setTheme.mockClear()
    renderer.resize.mockClear()
    renderer.sync.mockClear()

    const nextTheme: RendererTheme = { ...theme, background: '#222244' }
    rerender(
      <TerminalCanvas renderer={factory} metrics={metrics} theme={nextTheme} snapshot={snapshot} />,
    )
    expect(renderer.setTheme).toHaveBeenCalledWith(nextTheme)

    const nextMetrics: RendererMetrics = {
      ...metrics,
      cell: { ...metrics.cell, width: 16 },
    }
    const nextSnapshot = createSnapshot(3, 4)
    rerender(
      <TerminalCanvas renderer={factory} metrics={nextMetrics} theme={nextTheme} snapshot={nextSnapshot} />,
    )
    expect(renderer.resize).toHaveBeenCalledWith({ metrics: nextMetrics, snapshot: nextSnapshot })
    expect(renderer.sync).toHaveBeenCalledWith(nextSnapshot)
  })

  test('exposes imperative handle for updates', () => {
    const renderer = createRendererSpies()
    const factory = vi.fn<CreateCanvasRenderer>(() => renderer)
    const metrics = createMetrics()
    const snapshot = createSnapshot()
    const theme = createTheme()
    const ref = createRef<TerminalCanvasHandle>()

    const updates: CanvasRendererUpdateOptions = {
      snapshot,
      updates: [] satisfies TerminalUpdate[],
    }

    render(
      <TerminalCanvas
        renderer={factory}
        metrics={metrics}
        theme={theme}
        snapshot={snapshot}
        ref={(instance) => {
          ref.current = instance
        }}
      />,
    )

    expect(ref.current).not.toBeNull()
    act(() => {
      ref.current!.applyUpdates(updates)
      ref.current!.setTheme(theme)
      ref.current!.resize({ metrics, snapshot })
      ref.current!.sync(snapshot)
      ref.current!.dispose()
    })

    expect(renderer.applyUpdates).toHaveBeenCalledWith(updates)
    expect(renderer.setTheme).toHaveBeenCalledWith(theme)
    expect(renderer.resize).toHaveBeenCalledWith({ metrics, snapshot })
    expect(renderer.sync).toHaveBeenCalledWith(snapshot)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })

  test('emits diagnostics after operations', () => {
    const renderer = createRendererSpies()
    const factory = vi.fn<CreateCanvasRenderer>(() => renderer)
    const metrics = createMetrics()
    const snapshot = createSnapshot()
    const theme = createTheme()
    const onDiagnostics = vi.fn()

    const ref = createRef<TerminalCanvasHandle>()
    const updates: CanvasRendererUpdateOptions = { snapshot, updates: [] }

    render(
      <TerminalCanvas
        renderer={factory}
        metrics={metrics}
        theme={theme}
        snapshot={snapshot}
        ref={ref}
        onDiagnostics={onDiagnostics}
      />,
    )

    expect(onDiagnostics).toHaveBeenCalledWith(renderer.diagnostics)
    onDiagnostics.mockClear()

    act(() => {
      ref.current!.applyUpdates(updates)
    })

    expect(onDiagnostics).toHaveBeenCalledWith(renderer.diagnostics)
  })
})

type MockRenderer = CanvasRenderer & {
  applyUpdates: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  setTheme: ReturnType<typeof vi.fn>
  sync: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const createRendererSpies = (): MockRenderer => ({
  canvas: document.createElement('canvas') as HTMLCanvasElement,
  applyUpdates: vi.fn<(options: CanvasRendererUpdateOptions) => void>(),
  resize: vi.fn<(options: CanvasRendererResizeOptions) => void>(),
  setTheme: vi.fn<(nextTheme: RendererTheme) => void>(),
  sync: vi.fn<(nextSnapshot: TerminalState) => void>(),
  dispose: vi.fn<() => void>(),
  diagnostics: {
    lastFrameDurationMs: 0,
    lastDrawCallCount: 0,
  },
}) as MockRenderer
