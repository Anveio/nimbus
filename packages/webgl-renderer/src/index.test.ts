import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererConfiguration } from './types'

const presentFrame = vi.fn()

const createWebglStub = (): WebGL2RenderingContext => {
  const gl = {
    TEXTURE_2D: 0x0de1,
    UNPACK_ALIGNMENT: 0x0cf5,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    NEAREST: 0x2600,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    createShader: vi.fn(() => ({}) as WebGLShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => null),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({}) as WebGLProgram),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => null),
    deleteProgram: vi.fn(),
    createTexture: vi.fn(() => ({}) as WebGLTexture),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    disable: vi.fn(),
    clearColor: vi.fn(),
    getUniformLocation: vi.fn(() => ({}) as WebGLUniformLocation),
    uniform1i: vi.fn(),
    createVertexArray: vi.fn(() => ({}) as WebGLVertexArrayObject),
    createBuffer: vi.fn(() => ({}) as WebGLBuffer),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteBuffer: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    flush: vi.fn(),
    viewport: vi.fn(),
    pixelStorei: vi.fn(),
    useProgram: vi.fn(),
    readPixels: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
  } as unknown as WebGL2RenderingContext
  return gl
}

class StubCanvas {
  width = 0
  height = 0
  readonly style = { width: '', height: '' }
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  getContext(): unknown {
    return createWebglStub()
  }
}

Object.defineProperty(globalThis, 'HTMLCanvasElement', {
  value: StubCanvas,
  configurable: true,
})

const { createRendererRoot } = await import('./index')

const createConfiguration = (): RendererConfiguration => ({
  grid: { rows: 24, columns: 80 },
  surfaceDimensions: { width: 800, height: 600 },
  surfaceDensity: 2,
  surfaceOrientation: 'landscape',
  framebufferPixels: { width: 1600, height: 1200 },
  cell: { width: 8, height: 12, baseline: 9 },
})

describe('createRendererRoot', () => {
  beforeEach(() => {
    presentFrame.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders an initial frame after mounting', async () => {
    const configuration = createConfiguration()
    const container = new StubCanvas() as unknown as HTMLCanvasElement
    const root = createRendererRoot(container, {
      configuration,
    })
    const session = root.mount()

    const dispose = session.onFrame(presentFrame)
    await vi.runAllTimersAsync()

    expect(presentFrame).toHaveBeenCalledTimes(1)
    const frame = presentFrame.mock.calls[0]![0] as {
      metadata?: { reason?: string }
    }
    expect(frame.metadata?.reason).toBe('initial')
    dispose()
    session.free()
    root.dispose()
  })

  it('applies runtime updates when data is written', async () => {
    const configuration = createConfiguration()
    const container = new StubCanvas() as unknown as HTMLCanvasElement
    const root = createRendererRoot(container, {
      configuration,
    })
    const session = root.mount()
    const dispose = session.onFrame(presentFrame)
    await vi.runAllTimersAsync()
    presentFrame.mockClear()

    session.dispatch({ type: 'runtime.data', data: 'hello' })
    await vi.runAllTimersAsync()

    expect(presentFrame).toHaveBeenCalledTimes(1)
    const frame = presentFrame.mock.calls[0]![0] as {
      updates?: unknown[]
      metadata?: { reason?: string }
    }
    expect((frame.updates?.length ?? 0) > 0).toBe(true)
    expect(frame.metadata?.reason).toBe('apply-updates')
    dispose()
    session.free()
    root.dispose()
  })

  it('reconfigures the renderer when configuration dispatch is received', async () => {
    const configuration = createConfiguration()
    const container = new StubCanvas() as unknown as HTMLCanvasElement
    const root = createRendererRoot(container, {
      configuration,
    })
    const session = root.mount()
    const dispose = session.onFrame(presentFrame)
    await vi.runAllTimersAsync()
    presentFrame.mockClear()

    const nextConfiguration: RendererConfiguration = {
      ...configuration,
      grid: { rows: 48, columns: 120 },
    }
    session.dispatch({
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
    dispose()
    session.free()
    root.dispose()
  })
})
