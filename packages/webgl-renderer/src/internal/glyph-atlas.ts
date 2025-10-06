import type { TerminalCell } from '@mana/vt'
import type { RendererMetrics } from '../../../types'
import { fontString } from '../../../util/fonts'
import type { GlyphMeta } from '../renderer-types'
import {
  ATLAS_TEXTURE_FORMAT,
  ATLAS_TEXTURE_INTERNAL_FORMAT,
  ATLAS_TEXTURE_TYPE,
  DEFAULT_ATLAS_SIZE,
  MAX_ATLAS_PAGES,
} from './constants'
import { WebglError } from './gl-utils'

const GLYPH_PADDING = 0

interface AtlasPage {
  readonly texture: WebGLTexture
  readonly width: number
  readonly height: number
  cursorX: number
  cursorY: number
  rowHeight: number
}

interface RasterContext {
  canvas: OffscreenCanvas | HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
}

const ensureCanvas = (width: number, height: number): RasterContext => {
  const ensureContext = (
    canvas: OffscreenCanvas | HTMLCanvasElement,
  ): RasterContext => {
    canvas.width = Math.max(1, width)
    canvas.height = Math.max(1, height)
    const ctx = canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    }) as CanvasRenderingContext2D | null
    if (!ctx) {
      throw new WebglError(
        'Unable to obtain 2D context for glyph rasterisation',
      )
    }
    ctx.fillStyle = 'white'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return { canvas, ctx, width: canvas.width, height: canvas.height }
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    return ensureContext(new OffscreenCanvas(width, height) as OffscreenCanvas)
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    return ensureContext(canvas)
  }

  throw new WebglError('Unable to create canvas for glyph rasterisation')
}

const glyphKey = (cell: TerminalCell): string => {
  const attr = cell.attr
  return [
    cell.char,
    attr.bold ? 'b1' : 'b0',
    attr.italic ? 'i1' : 'i0',
    attr.foreground.type,
  ].join(':')
}

const isColorGlyph = (cell: TerminalCell): boolean =>
  cell.attr.foreground.type === 'rgb'

export class GlyphAtlas {
  private readonly gl: WebGL2RenderingContext
  private metrics: RendererMetrics
  private readonly pages: AtlasPage[] = []
  private readonly glyphs = new Map<string, GlyphMeta>()
  private raster: RasterContext
  constructor(gl: WebGL2RenderingContext, metrics: RendererMetrics) {
    this.gl = gl
    this.metrics = metrics
    this.raster = ensureCanvas(64, 64)
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  }

  setMetrics(metrics: RendererMetrics): void {
    this.metrics = metrics
    this.glyphs.clear()
    this.pages.forEach((page) => {
      page.cursorX = 0
      page.cursorY = 0
      page.rowHeight = 0
    })
  }

  getTexture(page: number): WebGLTexture {
    const existing = this.pages[page]
    if (!existing) {
      throw new WebglError(`Atlas page ${page} is not available`)
    }
    return existing.texture
  }

  private createPage(): number {
    if (this.pages.length >= MAX_ATLAS_PAGES) {
      throw new WebglError('Glyph atlas exceeded maximum page count')
    }
    const texture = this.gl.createTexture()
    if (!texture) {
      throw new WebglError('Failed to allocate glyph atlas texture')
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      ATLAS_TEXTURE_INTERNAL_FORMAT,
      DEFAULT_ATLAS_SIZE,
      DEFAULT_ATLAS_SIZE,
      0,
      ATLAS_TEXTURE_FORMAT,
      ATLAS_TEXTURE_TYPE,
      null,
    )
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.NEAREST,
    )
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.NEAREST,
    )
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE,
    )
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE,
    )
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)

    const page: AtlasPage = {
      texture,
      width: DEFAULT_ATLAS_SIZE,
      height: DEFAULT_ATLAS_SIZE,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
    }
    this.pages.push(page)
    return this.pages.length - 1
  }

  private allocateSlot(
    width: number,
    height: number,
  ): { page: number; x: number; y: number } | null {
    const slotWidth = width + GLYPH_PADDING * 2
    const slotHeight = height + GLYPH_PADDING * 2

    for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex += 1) {
      const page = this.pages[pageIndex]!
      const location = this.tryAllocateInPage(page, slotWidth, slotHeight)
      if (location) {
        return { page: pageIndex, x: location.x, y: location.y }
      }
    }

    const newPageIndex = this.createPage()
    const newPage = this.pages[newPageIndex]!
    const location = this.tryAllocateInPage(newPage, slotWidth, slotHeight)
    if (!location) {
      return null
    }
    return { page: newPageIndex, x: location.x, y: location.y }
  }

  private tryAllocateInPage(
    page: AtlasPage,
    slotWidth: number,
    slotHeight: number,
  ): { x: number; y: number } | null {
    if (slotWidth > page.width || slotHeight > page.height) {
      return null
    }

    if (page.cursorX + slotWidth > page.width) {
      page.cursorX = 0
      page.cursorY += page.rowHeight
      page.rowHeight = 0
    }

    if (page.cursorY + slotHeight > page.height) {
      return null
    }

    const x = page.cursorX + GLYPH_PADDING
    const y = page.cursorY + GLYPH_PADDING

    page.cursorX += slotWidth
    if (slotHeight > page.rowHeight) {
      page.rowHeight = slotHeight
    }

    return { x, y }
  }

  ensureGlyph(cell: TerminalCell): GlyphMeta {
    const key = glyphKey(cell)
    const cached = this.glyphs.get(key)
    if (cached) {
      return cached
    }

    const raster = this.rasterise(cell)
    const slot = this.allocateSlot(raster.width, raster.height)
    if (!slot) {
      throw new WebglError('Failed to allocate glyph slot in atlas')
    }

    const texture = this.pages[slot.page]!.texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0)
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,
      slot.x,
      slot.y,
      raster.textureWidth,
      raster.textureHeight,
      ATLAS_TEXTURE_FORMAT,
      ATLAS_TEXTURE_TYPE,
      raster.data,
    )
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)

    const pageInfo = this.pages[slot.page]!
    const meta: GlyphMeta = {
      page: slot.page,
      u0: slot.x / pageInfo.width,
      v0: slot.y / pageInfo.height,
      u1: (slot.x + raster.textureWidth) / pageInfo.width,
      v1: (slot.y + raster.textureHeight) / pageInfo.height,
      advance: raster.advance,
      bearingX: raster.bearingX,
      bearingY: raster.bearingY,
      width: raster.width,
      height: raster.height,
      textureWidth: raster.textureWidth,
      textureHeight: raster.textureHeight,
      padding: raster.padding,
      isColor: raster.isColor,
    }

    this.glyphs.set(key, meta)
    return meta
  }

  private rasterise(cell: TerminalCell): {
    width: number
    height: number
    textureWidth: number
    textureHeight: number
    data: Uint8ClampedArray
    advance: number
    bearingX: number
    bearingY: number
    padding: number
    isColor: boolean
  } {
    const dpr = this.metrics.devicePixelRatio
    const cellWidthPx = Math.ceil(this.metrics.cell.width * dpr)
    const cellHeightPx = Math.ceil(this.metrics.cell.height * dpr)
    const baselinePx = Math.ceil(this.metrics.cell.baseline * dpr)
    const padding = GLYPH_PADDING
    const textureWidth = cellWidthPx + padding * 2
    const textureHeight = cellHeightPx + padding * 2

    if (
      this.raster.width !== textureWidth ||
      this.raster.height !== textureHeight
    ) {
      this.raster.canvas.width = textureWidth
      this.raster.canvas.height = textureHeight
      this.raster.width = textureWidth
      this.raster.height = textureHeight
    }

    const ctx = this.raster.ctx
    ctx.clearRect(0, 0, textureWidth, textureHeight)
    ctx.font = fontString(this.metrics.font, cell.attr.bold, cell.attr.italic)
    ctx.fillStyle = 'white'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(cell.char, padding, padding + baselinePx)

    const data = ctx.getImageData(0, 0, textureWidth, textureHeight).data

    return {
      width: cellWidthPx,
      height: cellHeightPx,
      textureWidth,
      textureHeight,
      data,
      advance: cellWidthPx,
      bearingX: padding,
      bearingY: baselinePx,
      padding,
      isColor: isColorGlyph(cell),
    }
  }

  dispose(): void {
    for (const page of this.pages) {
      this.gl.deleteTexture(page.texture)
    }
    this.pages.length = 0
    this.glyphs.clear()
  }
}
