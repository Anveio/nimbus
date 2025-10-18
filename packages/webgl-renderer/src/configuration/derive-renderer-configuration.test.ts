import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererConfiguration } from '../types'
import {
  type DeriveRendererConfigurationOptions,
  deriveRendererConfiguration,
} from './derive-renderer-configuration'

class StubResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe = vi.fn()
  disconnect = vi.fn()
  trigger(entries: ResizeObserverEntry[] = []): void {
    this.callback(entries, this as unknown as ResizeObserver)
  }
}

const ORIGINAL_RESIZE_OBSERVER = globalThis.ResizeObserver

const createCanvas = (): HTMLCanvasElement => {
  const ownerDocument = {
    defaultView: {
      devicePixelRatio: 2,
      getComputedStyle: vi.fn(() => ({
        font: 'normal 400 16px/20px monospace',
        fontSize: '16px',
        lineHeight: '20px',
        fontStyle: 'normal',
        fontVariant: 'normal',
        fontWeight: '400',
        fontFamily: 'monospace',
      })),
    },
    createElement: vi.fn(() => ({
      getContext: vi.fn(() => ({
        font: '',
        measureText: vi.fn(() => ({
          width: 80,
          actualBoundingBoxAscent: 12,
          actualBoundingBoxDescent: 4,
        })),
      })),
    })),
  } as unknown as Document

  const canvas = {
    ownerDocument,
    getBoundingClientRect: () =>
      ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  } as unknown as HTMLCanvasElement

  Object.defineProperty(canvas, 'clientWidth', {
    value: 800,
    configurable: true,
  })
  Object.defineProperty(canvas, 'clientHeight', {
    value: 600,
    configurable: true,
  })
  return canvas
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('deriveRendererConfiguration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: StubResizeObserver,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (ORIGINAL_RESIZE_OBSERVER) {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        value: ORIGINAL_RESIZE_OBSERVER,
        configurable: true,
      })
    } else {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: undefined,
      })
    }
  })

  it('computes a configuration snapshot for the host canvas', async () => {
    const canvas = createCanvas()
    const controller = deriveRendererConfiguration(canvas, {
      measureCellMetrics: () => ({
        width: 8,
        height: 16,
        baseline: 12,
      }),
    })
    await flushMicrotasks()

    const configuration = controller.configuration as RendererConfiguration
    expect(configuration).toBeTruthy()
    expect(configuration.surfaceDensity).toBe(2)
    expect(configuration.surfaceDimensions.width).toBe(800)
    expect(configuration.surfaceDimensions.height).toBe(600)
    expect(configuration.surfaceOrientation).toBe('landscape')
    expect(configuration.framebufferPixels?.width).toBe(1600)
    expect(configuration.framebufferPixels?.height).toBe(1200)
    expect(configuration.grid.columns).toBe(Math.floor(800 / 8))
    expect(configuration.grid.rows).toBe(Math.floor(600 / 16))
    expect(configuration.cell.baseline).toBe(12)
  })

  it('notifies subscribers when measurements change', async () => {
    const canvas = createCanvas()
    const measureCellMetrics = vi.fn<
      NonNullable<DeriveRendererConfigurationOptions['measureCellMetrics']>
    >(() => ({
      width: 10,
      height: 20,
      baseline: 14,
    }))

    const controller = deriveRendererConfiguration(canvas, {
      measureCellMetrics,
    })
    await flushMicrotasks()

    const listener = vi.fn()
    controller.subscribe(listener)

    Object.defineProperty(canvas, 'clientWidth', {
      value: 1200,
      configurable: true,
    })
    canvas.getBoundingClientRect = () =>
      ({
        width: 1200,
        height: 600,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    controller.refresh()
    await flushMicrotasks()

    expect(listener).toHaveBeenCalledTimes(2)
    const configuration = listener.mock.calls[1]![0] as RendererConfiguration
    expect(configuration.grid.columns).toBe(Math.floor(1200 / 10))
    expect(measureCellMetrics).toHaveBeenCalledTimes(2)
  })

  it('re-runs measurements after fonts finish loading', async () => {
    const canvas = createCanvas()
    let scale = 1
    const measureCellMetrics = vi.fn<
      NonNullable<DeriveRendererConfigurationOptions['measureCellMetrics']>
    >(() => ({
      width: 8 * scale,
      height: 16 * scale,
      baseline: 12 * scale,
    }))

    let resolveFontsReady: (() => void) | undefined
    const readyPromise = new Promise<void>((resolve) => {
      resolveFontsReady = () => {
        resolve()
      }
    })
    const documentWithFonts = canvas.ownerDocument as Document & {
      fonts?: FontFaceSet
    }
    documentWithFonts.fonts = {
      ready: readyPromise,
    } as unknown as FontFaceSet

    const controller = deriveRendererConfiguration(canvas, {
      measureCellMetrics,
    })
    await flushMicrotasks()

    expect(controller.configuration?.cell.width).toBe(8)
    expect(measureCellMetrics).toHaveBeenCalledTimes(1)

    scale = 2
    resolveFontsReady?.()
    await flushMicrotasks()

    expect(measureCellMetrics).toHaveBeenCalledTimes(2)
    expect(controller.configuration?.cell.width).toBe(16)
  })
})
