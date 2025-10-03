import type { CanvasLike, RendererMetrics } from '../../../types'
import { fontString } from './fonts'

interface GlyphStyle {
  readonly bold: boolean
  readonly italic: boolean
}

export interface GlyphInfo {
  readonly u1: number
  readonly v1: number
  readonly u2: number
  readonly v2: number
  readonly width: number
  readonly height: number
}

interface GlyphAtlasOptions {
  readonly metrics: RendererMetrics
  readonly canvasFactory?: () => CanvasLike
}

const DEFAULT_SIZE = 2048
const PADDING = 2

const createCanvas = (factory?: () => CanvasLike): CanvasLike => {
  if (factory) {
    const canvas = factory()
    if (!canvas.width) {
      canvas.width = DEFAULT_SIZE
    }
    if (!canvas.height) {
      canvas.height = DEFAULT_SIZE
    }
    return canvas
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(
      DEFAULT_SIZE,
      DEFAULT_SIZE,
    ) as unknown as CanvasLike
    return offscreen
  }
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    const element = document.createElement('canvas') as HTMLCanvasElement
    element.width = DEFAULT_SIZE
    element.height = DEFAULT_SIZE
    return element as unknown as CanvasLike
  }
  throw new Error('Unable to create canvas for glyph atlas')
}

const glyphKey = (char: string, style: GlyphStyle): string =>
  `${style.bold ? 'b' : 'n'}${style.italic ? 'i' : 'r'}:${char}`

export class GlyphAtlas {
  private canvas: CanvasLike
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private cursorX: number
  private cursorY: number
  private rowHeight: number
  private metrics: RendererMetrics
  private readonly cache = new Map<string, GlyphInfo>()
  private dirty = true

  constructor(options: GlyphAtlasOptions) {
    this.metrics = options.metrics
    this.canvas = createCanvas(options.canvasFactory)
    this.width = this.canvas.width || DEFAULT_SIZE
    this.height = this.canvas.height || DEFAULT_SIZE
    if (!this.canvas.width) {
      this.canvas.width = this.width
    }
    if (!this.canvas.height) {
      this.canvas.height = this.height
    }

    const ctx = this.canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    }) as CanvasRenderingContext2D | null
    if (!ctx) {
      throw new Error('Unable to obtain 2D context for glyph atlas')
    }

    this.ctx = ctx
    this.ctx.fillStyle = 'white'
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'alphabetic'
    this.cursorX = 0
    this.cursorY = 0
    this.rowHeight = this.metrics.cell.height + PADDING * 2
  }

  getCanvas(): CanvasLike {
    return this.canvas
  }

  consumeDirtyFlag(): boolean {
    const wasDirty = this.dirty
    this.dirty = false
    return wasDirty
  }

  reset(metrics: RendererMetrics): void {
    this.cache.clear()
    this.metrics = metrics
    this.cursorX = 0
    this.cursorY = 0
    this.rowHeight = metrics.cell.height + PADDING * 2
    this.ctx.clearRect(0, 0, this.width, this.height)
    this.dirty = true
  }

  private ensureRowSpace(glyphWidth: number, glyphHeight: number): void {
    if (this.cursorX + glyphWidth > this.width) {
      this.cursorX = 0
      this.cursorY += this.rowHeight
      this.rowHeight = glyphHeight
    }
    if (this.cursorY + glyphHeight > this.height) {
      this.growCanvas()
    }
  }

  private growCanvas(): void {
    const nextWidth = this.width
    const nextHeight = this.height * 2
    const newCanvas = createCanvas(() => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(
          nextWidth,
          nextHeight,
        ) as unknown as CanvasLike
      }
      if (
        typeof document !== 'undefined' &&
        typeof document.createElement === 'function'
      ) {
        const element = document.createElement('canvas') as HTMLCanvasElement
        element.width = nextWidth
        element.height = nextHeight
        return element as unknown as CanvasLike
      }
      throw new Error('Unable to grow glyph atlas canvas')
    })

    const newCtx = newCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    }) as CanvasRenderingContext2D | null
    if (!newCtx) {
      throw new Error('Unable to obtain context for grown glyph atlas')
    }

    newCtx.drawImage(this.canvas as unknown as CanvasImageSource, 0, 0)
    newCtx.textAlign = 'left'
    newCtx.textBaseline = 'alphabetic'
    newCtx.fillStyle = 'white'

    this.canvas = newCanvas
    this.ctx = newCtx
    this.width = nextWidth
    this.height = nextHeight
    this.dirty = true
  }

  getGlyph(char: string, style: GlyphStyle): GlyphInfo {
    const key = glyphKey(char, style)
    const cached = this.cache.get(key)
    if (cached) {
      return cached
    }

    const cellWidth = this.metrics.cell.width
    const cellHeight = this.metrics.cell.height
    const baseline = this.metrics.cell.baseline
    const glyphWidth = cellWidth + PADDING * 2
    const glyphHeight = cellHeight + PADDING * 2

    this.ensureRowSpace(glyphWidth, glyphHeight)

    const drawX = this.cursorX + PADDING
    const drawY = this.cursorY + PADDING

    this.ctx.clearRect(this.cursorX, this.cursorY, glyphWidth, glyphHeight)
    this.ctx.font = fontString(this.metrics.font, style.bold, style.italic)
    this.ctx.fillText(char, drawX, drawY + baseline)

    const u1 = drawX / this.width
    const u2 = (drawX + cellWidth) / this.width
    const vTop = 1 - drawY / this.height
    const vBottom = 1 - (drawY + cellHeight) / this.height

    const info: GlyphInfo = {
      u1,
      v1: vBottom,
      u2,
      v2: vTop,
      width: cellWidth,
      height: cellHeight,
    }

    this.cache.set(key, info)
    this.cursorX += glyphWidth
    if (glyphHeight > this.rowHeight) {
      this.rowHeight = glyphHeight
    }
    this.dirty = true
    return info
  }
}
