import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

if (typeof window !== 'undefined' && !(window as any).ResizeObserver) {
  type ResizeObserverCallback = (
    entries: Array<{ target: Element; contentRect: { width: number; height: number } }>,
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
      this.callback([{ target, contentRect: { width, height } }], this as unknown as ResizeObserver)
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  ;(window as any).ResizeObserver = ResizeObserverPolyfill
}

vi.mock('@mana-ssh/tui-web-canvas-renderer', () => {
  const createCanvasRenderer = vi.fn((options: any) => {
    const instance: any = {
      canvas: options.canvas,
      applyUpdates: vi.fn(),
      resize: vi.fn(),
      setTheme: vi.fn(),
      sync: vi.fn(),
      dispose: vi.fn(),
      diagnostics: {
        lastFrameDurationMs: null,
        lastDrawCallCount: null,
        lastOsc: null,
        lastSosPmApc: null,
        lastDcs: null,
      },
      currentSelection: options.snapshot?.selection ?? null,
    }

    let selectionListener = options.onSelectionChange
    Object.defineProperty(instance, 'onSelectionChange', {
      configurable: true,
      enumerable: true,
      get: () => selectionListener,
      set: (listener) => {
        selectionListener = listener
        selectionListener?.(instance.currentSelection)
      },
    })

    selectionListener?.(instance.currentSelection)

    return instance
  })

  return {
    createCanvasRenderer,
  }
})
