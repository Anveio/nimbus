import type { TerminalCell } from '@mana/vt'
import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest'
import type { RendererMetrics } from '../../../types'
import { GlyphAtlas } from './glyph-atlas'
import { DEFAULT_ATLAS_SIZE } from './constants'
import { WebglError } from './gl-utils'

class FakeCanvasContext2D {
  fillStyle = ''
  textAlign = ''
  textBaseline = ''
  font = ''
  clearRect = vi.fn()
  fillText = vi.fn()
  getImageData = vi.fn((_: number, __: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
  }))
}

class FakeOffscreenCanvas {
  width: number
  height: number
  private readonly context: FakeCanvasContext2D

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.context = new FakeCanvasContext2D()
  }

  getContext(contextId: '2d'): CanvasRenderingContext2D | null
  getContext(contextId: string): unknown
  getContext(contextId: string): CanvasRenderingContext2D | null {
    if (contextId === '2d') {
      return this.context as unknown as CanvasRenderingContext2D
    }
    return null
  }
}

const baseCell = (overrides: Partial<TerminalCell> = {}): TerminalCell => ({
  char: 'a',
  attr: {
    bold: false,
    faint: false,
    italic: false,
    underline: 'none',
    blink: 'none',
    inverse: false,
    hidden: false,
    strikethrough: false,
    foreground: { type: 'default' },
    background: { type: 'default' },
  },
  protected: false,
  ...overrides,
})

type MetricsOverrides = Partial<Omit<RendererMetrics, 'cell' | 'font'>> & {
  cell?: Partial<RendererMetrics['cell']>
  font?: Partial<RendererMetrics['font']>
}

const createMetrics = (overrides: MetricsOverrides = {}): RendererMetrics => ({
  devicePixelRatio: overrides.devicePixelRatio ?? 1,
  cell: {
    width: overrides.cell?.width ?? 10,
    height: overrides.cell?.height ?? 20,
    baseline: overrides.cell?.baseline ?? 14,
  },
  font: {
    family: overrides.font?.family ?? 'monospace',
    size: overrides.font?.size ?? 12,
    letterSpacing: overrides.font?.letterSpacing ?? 0,
    lineHeight: overrides.font?.lineHeight ?? 1.2,
  },
})

interface MockGlContext {
  gl: WebGL2RenderingContext
  texSubImage2D: ReturnType<typeof vi.fn>
  createTexture: ReturnType<typeof vi.fn>
  deleteTexture: ReturnType<typeof vi.fn>
}

const createMockWebGL2 = (): MockGlContext => {
  const textures = new Set<unknown>()
  const createTexture = vi.fn(() => {
    const texture = {} as unknown
    textures.add(texture)
    return texture as WebGLTexture
  })
  const deleteTexture = vi.fn((texture: WebGLTexture | null) => {
    if (texture) {
      textures.delete(texture)
    }
  })
  const texSubImage2D = vi.fn()
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
    createTexture,
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    texSubImage2D,
    pixelStorei: vi.fn(),
    deleteTexture,
  } as unknown as WebGL2RenderingContext
  return { gl, texSubImage2D, createTexture, deleteTexture }
}

describe('GlyphAtlas', () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas

  beforeAll(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas
  })

  afterAll(() => {
    globalThis.OffscreenCanvas = originalOffscreenCanvas
  })

  test('uploads glyph data once per unique key and caches metadata', () => {
    const { gl, texSubImage2D } = createMockWebGL2()
    const atlas = new GlyphAtlas(gl, createMetrics())

    const first = atlas.ensureGlyph(baseCell())
    const second = atlas.ensureGlyph(baseCell())

    expect(second).toBe(first)
    expect(texSubImage2D).toHaveBeenCalledTimes(1)
  })

  test('resetting metrics clears cache and atlas write cursors', () => {
    const { gl, texSubImage2D } = createMockWebGL2()
    const atlas = new GlyphAtlas(gl, createMetrics())

    const cell = baseCell({ char: 'x' })
    const first = atlas.ensureGlyph(cell)
    const { pages } = atlas as unknown as {
      pages: Array<{ cursorX: number; cursorY: number }>
    }
    const page = pages[0]
    if (!page) {
      throw new Error('expected atlas page to exist after first glyph')
    }
    expect(page.cursorX).toBeGreaterThan(0)

    atlas.setMetrics(createMetrics({ cell: { width: 11 } }))

    const resetPage = pages[0]
    if (!resetPage) {
      throw new Error('expected atlas page to persist after metrics reset')
    }
    expect(resetPage.cursorX).toBe(0)
    const second = atlas.ensureGlyph(cell)

    expect(second).not.toBe(first)
    expect(texSubImage2D).toHaveBeenCalledTimes(2)
  })

  test('throws when glyph will not fit within atlas bounds', () => {
    const { gl } = createMockWebGL2()
    const metrics = createMetrics({ cell: { width: DEFAULT_ATLAS_SIZE + 1, height: 2, baseline: 1 } })
    const atlas = new GlyphAtlas(gl, metrics)

    expect(() => atlas.ensureGlyph(baseCell())).toThrow(WebglError)
  })

  test('dispose releases allocated textures', () => {
    const { gl, createTexture, deleteTexture } = createMockWebGL2()
    const atlas = new GlyphAtlas(gl, createMetrics())

    atlas.ensureGlyph(baseCell({ char: 'y' }))
    expect(createTexture).toHaveBeenCalledTimes(1)

    const texture = createTexture.mock.results[0]!.value as WebGLTexture
    atlas.dispose()

    expect(deleteTexture).toHaveBeenCalledWith(texture)
  })
})
