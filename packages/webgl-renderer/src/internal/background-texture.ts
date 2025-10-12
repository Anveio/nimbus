import type { SelectionRowSegment, TerminalCell, TerminalState } from '@nimbus/vt'
import type { RendererTheme } from '../types'
import { rendererColorToRgba, resolveCellColorBytes } from './colors'
import {
  CONTENT_TEXTURE_FORMAT,
  CONTENT_TEXTURE_INTERNAL_FORMAT,
  CONTENT_TEXTURE_TYPE,
} from './constants'
import { WebglError } from './gl-utils'

export class BackgroundTexture {
  private readonly gl: WebGL2RenderingContext
  private texture: WebGLTexture | null = null
  private width = 0
  private height = 0
  private data: Uint8Array = new Uint8Array(0)
  private dirty = false
  private fallbackForeground: string
  private fallbackBackground: string
  private paletteOverrides = new Map<number, string>()

  constructor(gl: WebGL2RenderingContext, theme: RendererTheme) {
    this.gl = gl
    this.fallbackForeground = theme.foreground
    this.fallbackBackground = theme.background
    this.createTexture()
  }

  setTheme(theme: RendererTheme): void {
    this.fallbackForeground = theme.foreground
    this.fallbackBackground = theme.background
    this.paletteOverrides.clear()
    this.dirty = true
  }

  setPaletteOverride(index: number, color: string | null): void {
    if (color === null) {
      this.paletteOverrides.delete(index)
    } else {
      this.paletteOverrides.set(index, color)
    }
    this.dirty = true
  }

  clearPaletteOverrides(): void {
    this.paletteOverrides.clear()
    this.dirty = true
  }

  getTexture(): WebGLTexture {
    if (!this.texture) {
      this.createTexture()
    }
    if (!this.texture) {
      throw new WebglError('Background texture is not initialised')
    }
    return this.texture
  }

  private createTexture(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture)
    }
    this.texture = this.gl.createTexture()
    if (!this.texture) {
      throw new WebglError('Failed to allocate background texture')
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
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
  }

  resize(columns: number, rows: number): void {
    if (columns === this.width && rows === this.height && this.texture) {
      return
    }
    this.width = Math.max(1, columns)
    this.height = Math.max(1, rows)
    this.data = new Uint8Array(this.width * this.height * 4)
    this.dirty = true
  }

  updateFromSnapshot(
    snapshot: TerminalState,
    theme: RendererTheme,
    selectionSegments: Map<number, SelectionRowSegment> | null,
    selectionTheme: RendererTheme['selection'] | undefined,
  ): void {
    this.resize(snapshot.columns, snapshot.rows)
    const overrides = this.paletteOverrides
    const reverseVideo = Boolean(snapshot.reverseVideo)
    const fallbackFg = reverseVideo ? theme.background : this.fallbackForeground
    const fallbackBg = reverseVideo ? theme.foreground : this.fallbackBackground
    const _selectionFg = selectionTheme?.foreground
      ? rendererColorToRgba(selectionTheme.foreground)
      : null
    const selectionBg = selectionTheme?.background
      ? rendererColorToRgba(selectionTheme.background)
      : null

    let offset = 0
    for (let row = 0; row < snapshot.rows; row += 1) {
      const bufferRow = snapshot.buffer[row]
      const selectionSegment = selectionSegments?.get(row) ?? null
      for (let column = 0; column < snapshot.columns; column += 1) {
        const cell: TerminalCell | undefined = bufferRow?.[column]
        const colors = resolveCellColorBytes(
          cell?.attr ?? snapshot.attributes,
          theme,
          overrides,
          fallbackFg,
          fallbackBg,
        )
        let rgba = colors.background ?? rendererColorToRgba(fallbackBg)
        if (
          selectionSegment &&
          column >= selectionSegment.startColumn &&
          column <= selectionSegment.endColumn
        ) {
          rgba = selectionBg ?? rgba
        }
        this.data[offset] = rgba[0]
        this.data[offset + 1] = rgba[1]
        this.data[offset + 2] = rgba[2]
        this.data[offset + 3] = rgba[3]
        offset += 4
      }
    }
    this.dirty = true
  }

  updateCell(
    row: number,
    column: number,
    cell: TerminalCell,
    theme: RendererTheme,
  ): void {
    if (row >= this.height || column >= this.width) {
      return
    }
    const colors = resolveCellColorBytes(
      cell.attr,
      theme,
      this.paletteOverrides,
      this.fallbackForeground,
      this.fallbackBackground,
    )
    const rgba =
      colors.background ?? rendererColorToRgba(this.fallbackBackground)
    const index = (row * this.width + column) * 4
    this.data[index] = rgba[0]
    this.data[index + 1] = rgba[1]
    this.data[index + 2] = rgba[2]
    this.data[index + 3] = rgba[3]
    this.dirty = true
  }

  updateRows(
    snapshot: TerminalState,
    theme: RendererTheme,
    rows: ReadonlyArray<number>,
    selectionSegments: Map<number, SelectionRowSegment> | null,
  ): void {
    if (rows.length === 0) {
      return
    }
    const reverseVideo = Boolean(snapshot.reverseVideo)
    const fallbackFg = reverseVideo ? theme.background : this.fallbackForeground
    const fallbackBg = reverseVideo ? theme.foreground : this.fallbackBackground
    const overrides = this.paletteOverrides

    for (const row of rows) {
      if (row < 0 || row >= this.height) {
        continue
      }
      const bufferRow = snapshot.buffer[row]
      const selectionSegment = selectionSegments?.get(row) ?? null
      for (let column = 0; column < snapshot.columns; column += 1) {
        const cell: TerminalCell | undefined = bufferRow?.[column]
        const colors = resolveCellColorBytes(
          cell?.attr ?? snapshot.attributes,
          theme,
          overrides,
          fallbackFg,
          fallbackBg,
        )
        let rgba = colors.background ?? rendererColorToRgba(fallbackBg)
        if (selectionSegment) {
          const inSelection =
            column >= selectionSegment.startColumn &&
            column <= selectionSegment.endColumn
          if (inSelection && theme.selection?.background) {
            rgba = rendererColorToRgba(theme.selection.background)
          }
        }
        const index = (row * this.width + column) * 4
        this.data[index] = rgba[0]
        this.data[index + 1] = rgba[1]
        this.data[index + 2] = rgba[2]
        this.data[index + 3] = rgba[3]
      }
    }

    this.dirty = true
  }

  uploadIfDirty(): void {
    if (!this.dirty || !this.texture) {
      return
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      CONTENT_TEXTURE_INTERNAL_FORMAT,
      this.width,
      this.height,
      0,
      CONTENT_TEXTURE_FORMAT,
      CONTENT_TEXTURE_TYPE,
      this.data,
    )
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)
    this.dirty = false
  }

  dispose(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture)
      this.texture = null
    }
    this.data = new Uint8Array(0)
  }
}
