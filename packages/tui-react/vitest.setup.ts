import type { TerminalSelection } from '@mana/vt'
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

const win = globalThis as typeof window & {
  ResizeObserver?: typeof ResizeObserver
}

if (typeof window !== 'undefined' && !win.ResizeObserver) {
  type ResizeObserverCallback = (
    entries: Array<{
      target: Element
      contentRect: { width: number; height: number }
    }>,
    observer: ResizeObserver,
  ) => void

  class ResizeObserverPolyfill {
    private readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element): void {
      const width = (target as HTMLElement).clientWidth ?? 0
      const height = (target as HTMLElement).clientHeight ?? 0
      this.callback(
        [{ target, contentRect: { width, height } }],
        this as unknown as ResizeObserver,
      )
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  win.ResizeObserver =
    ResizeObserverPolyfill as unknown as typeof ResizeObserver
}

vi.mock('@mana/tui-web-canvas-renderer', () => {
  type SelectionSnapshot = { selection?: TerminalSelection | null } | undefined
  type RendererOptions = {
    canvas: HTMLCanvasElement | null
    snapshot?: SelectionSnapshot
    onSelectionChange?: (selection: TerminalSelection | null) => void
  } & Record<string, unknown>

  type CanvasRendererMock = {
    canvas: HTMLCanvasElement | null
    diagnostics: {
      lastFrameDurationMs: number | null
      lastDrawCallCount: number | null
      lastOsc: string | null
      lastSosPmApc: string | null
      lastDcs: string | null
    }
    currentSelection: TerminalSelection | null
    applyUpdates: ReturnType<
      typeof vi.fn<(payload: { snapshot?: SelectionSnapshot }) => void>
    >
    resize: ReturnType<
      typeof vi.fn<(payload: { snapshot?: SelectionSnapshot }) => void>
    >
    setTheme: ReturnType<typeof vi.fn<() => void>>
    sync: ReturnType<typeof vi.fn<(snapshot: SelectionSnapshot) => void>>
    dispose: ReturnType<typeof vi.fn<() => void>>
    onSelectionChange?: (selection: TerminalSelection | null) => void
  }

  const createCanvasRenderer = vi.fn((options: RendererOptions) => {
    const instance: CanvasRendererMock = {
      canvas: options.canvas,
      diagnostics: {
        lastFrameDurationMs: null,
        lastDrawCallCount: null,
        lastOsc: null,
        lastSosPmApc: null,
        lastDcs: null,
      },
      currentSelection: options.snapshot?.selection ?? null,
      applyUpdates: vi.fn(),
      resize: vi.fn(),
      setTheme: vi.fn(),
      sync: vi.fn(),
      dispose: vi.fn(),
    }

    let selectionListener = options.onSelectionChange
    const notifySelection = () => {
      selectionListener?.(instance.currentSelection)
    }

    instance.applyUpdates = vi.fn(
      ({ snapshot }: { snapshot?: SelectionSnapshot }) => {
        const next = snapshot?.selection ?? null
        if (
          JSON.stringify(next) !== JSON.stringify(instance.currentSelection)
        ) {
          instance.currentSelection = next
          notifySelection()
        }
      },
    )

    instance.resize = vi.fn(
      ({ snapshot }: { snapshot?: SelectionSnapshot }) => {
        const next = snapshot?.selection ?? null
        if (
          JSON.stringify(next) !== JSON.stringify(instance.currentSelection)
        ) {
          instance.currentSelection = next
          notifySelection()
        }
      },
    )

    instance.sync = vi.fn((snapshot: SelectionSnapshot) => {
      const next = snapshot?.selection ?? null
      if (JSON.stringify(next) !== JSON.stringify(instance.currentSelection)) {
        instance.currentSelection = next
        notifySelection()
      }
    })

    Object.defineProperty(instance, 'onSelectionChange', {
      configurable: true,
      enumerable: true,
      get: () => selectionListener,
      set: (listener) => {
        selectionListener = listener
        notifySelection()
      },
    })

    notifySelection()

    return instance
  })

  return {
    createCanvasRenderer,
  }
})
