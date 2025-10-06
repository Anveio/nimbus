import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import type {
  CreateRendererOptions,
  RendererConfiguration,
  WebglRendererConfig,
} from './types'

const presentFrame = vi.fn()
const configureSession = vi.fn()
const disposeSession = vi.fn()
const observersRef: { onFrame?: ((event: any) => void) | null } = {
  onFrame: null,
}

class StubCanvas {
  width = 0
  height = 0
  readonly style = { width: '', height: '' }
  getContext(): unknown {
    return {
      readPixels: vi.fn(),
    }
  }
}

Object.defineProperty(globalThis, 'HTMLCanvasElement', {
  value: StubCanvas,
  configurable: true,
})

vi.mock('@mana/tui-web-canvas-renderer', () => ({
  createRendererSession: vi.fn((options) => {
    observersRef.onFrame = options.observers?.onFrame ?? null
    return {
      canvas: options.canvas,
      backend: 'gpu-webgl',
      presentFrame: (frame: unknown) => {
        presentFrame(frame)
        observersRef.onFrame?.({
          backend: 'gpu-webgl',
          timestamp: performance.now(),
          diagnostics: null,
          metadata: (frame as { metadata?: unknown }).metadata ?? {},
        })
      },
      configure: configureSession,
      getDiagnostics: () => null,
      dispose: disposeSession,
    }
  }),
}))

const { createRenderer } = await import('./index')

const createConfiguration = (): RendererConfiguration => ({
  grid: { rows: 24, columns: 80 },
  cssPixels: { width: 800, height: 600 },
  devicePixelRatio: 2,
  framebufferPixels: { width: 1600, height: 1200 },
  cell: { width: 8, height: 12, baseline: 9 },
})

describe('createRenderer', () => {
  beforeEach(() => {
    presentFrame.mockClear()
    configureSession.mockClear()
    disposeSession.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders an initial frame after mounting', async () => {
    const configuration = createConfiguration()
    const renderer = await createRenderer({
      rendererConfig: configuration,
    } satisfies CreateRendererOptions<WebglRendererConfig>)

    const canvas = new StubCanvas() as unknown as HTMLCanvasElement
    renderer.mount({ renderRoot: canvas })
    await vi.runAllTimersAsync()

    expect(presentFrame).toHaveBeenCalledTimes(1)
    const frame = presentFrame.mock.calls[0]![0] as {
      metadata?: { reason?: string }
    }
    expect(frame.metadata?.reason).toBe('initial')
    renderer.free()
  })

  it('applies runtime updates when data is written', async () => {
    const configuration = createConfiguration()
    const renderer = await createRenderer({ rendererConfig: configuration })
    const canvas = new StubCanvas() as unknown as HTMLCanvasElement
    renderer.mount({ renderRoot: canvas })
    await vi.runAllTimersAsync()
    presentFrame.mockClear()

    renderer.dispatch({ type: 'runtime.data', data: 'hello' })
    await vi.runAllTimersAsync()

    expect(presentFrame).toHaveBeenCalledTimes(1)
    const frame = presentFrame.mock.calls[0]![0] as {
      updates?: unknown[]
      metadata?: { reason?: string }
    }
    expect((frame.updates?.length ?? 0) > 0).toBe(true)
    expect(frame.metadata?.reason).toBe('apply-updates')
    renderer.free()
  })

  it('reconfigures the renderer when configuration dispatch is received', async () => {
    const configuration = createConfiguration()
    const renderer = await createRenderer({ rendererConfig: configuration })
    const canvas = new StubCanvas() as unknown as HTMLCanvasElement
    renderer.mount({ renderRoot: canvas })
    await vi.runAllTimersAsync()
    presentFrame.mockClear()

    const nextConfiguration: RendererConfiguration = {
      ...configuration,
      grid: { rows: 48, columns: 120 },
    }
    renderer.dispatch({
      type: 'renderer.configure',
      configuration: nextConfiguration,
    })
    await vi.runAllTimersAsync()

    expect(presentFrame).toHaveBeenCalledTimes(1)
    const frame = presentFrame.mock.calls[0]![0] as {
      metadata?: { reason?: string }
      viewport: { rows: number; columns: number }
    }
    expect(frame.metadata?.reason).toBe('sync')
    expect(frame.viewport.rows).toBe(48)
    renderer.free()
  })
})
