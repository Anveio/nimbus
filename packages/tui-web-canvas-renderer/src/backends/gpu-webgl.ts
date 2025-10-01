import type {
  SelectionRowSegment,
  TerminalAttributes,
  TerminalCell,
  TerminalSelection,
  TerminalState,
} from '@mana-ssh/vt'
import { getSelectionRowSegments } from '@mana-ssh/vt'
import { ColorCache } from '../internal/color-cache'
import {
  type PaletteOverrides,
  resolveCellColors,
  resolvePaletteOverrideColor,
} from '../internal/colors'
import { DirtyRegionTracker } from '../internal/dirty-region-tracker'
import type { GlyphInfo } from '../internal/glyph-atlas'
import { GlyphAtlas } from '../internal/glyph-atlas'
import { ensureCanvasDimensions, setCanvasStyleSize } from '../internal/layout'
import type {
  CanvasLike,
  CanvasRenderer,
  CanvasRendererDiagnostics,
  CanvasRendererOptions,
  RendererBackendProvider,
  RendererColor,
  RendererMetrics,
  RendererTheme,
  WebglBackendConfig,
} from '../types'

const WEBGL1_REQUIRED_EXTENSIONS = [
  'ANGLE_instanced_arrays',
  'OES_vertex_array_object',
  'OES_texture_float',
] as const

const DEFAULT_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  depth: false,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
}

interface ShaderBundle {
  readonly backgroundVertex: string
  readonly backgroundFragment: string
  readonly glyphVertex: string
  readonly glyphFragment: string
  readonly overlayVertex: string
  readonly overlayFragment: string
}

const SHADERS_WEBGL1: ShaderBundle = {
  backgroundVertex: `precision mediump float;\nprecision mediump int;\nattribute vec2 a_position;\nattribute vec4 a_color;\nvarying vec4 v_color;\nvoid main() {\n  v_color = a_color;\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
  backgroundFragment: `precision mediump float;\nprecision mediump int;\nvarying vec4 v_color;\nvoid main() {\n  gl_FragColor = v_color;\n}`,
  glyphVertex: `precision mediump float;\nprecision mediump int;\nattribute vec2 a_position;\nattribute vec2 a_texCoord;\nattribute vec4 a_color;\nvarying vec2 v_texCoord;\nvarying vec4 v_color;\nvoid main() {\n  v_texCoord = a_texCoord;\n  v_color = a_color;\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
  glyphFragment: `precision mediump float;\nprecision mediump int;\nvarying vec2 v_texCoord;\nvarying vec4 v_color;\nuniform sampler2D u_texture;\nvoid main() {\n  vec4 sample = texture2D(u_texture, v_texCoord);\n  gl_FragColor = vec4(sample.rgb * v_color.rgb, sample.a * v_color.a);\n}`,
  overlayVertex: `precision mediump float;\nprecision mediump int;\nattribute vec2 a_position;\nattribute vec2 a_texCoord;\nvarying vec2 v_texCoord;\nvoid main() {\n  v_texCoord = a_texCoord;\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
  overlayFragment: `precision mediump float;\nprecision mediump int;\nvarying vec2 v_texCoord;\nuniform sampler2D u_overlay;\nvoid main() {\n  gl_FragColor = texture2D(u_overlay, v_texCoord);\n}`,
}

const SHADERS_WEBGL2: ShaderBundle = {
  backgroundVertex: `#version 300 es\nprecision mediump float;\nprecision mediump int;\nlayout(location = 0) in vec2 a_position;\nin vec4 a_color;\nout vec4 v_color;\nvoid main() {\n  v_color = a_color;\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
  backgroundFragment: `#version 300 es\nprecision mediump float;\nprecision mediump int;\nin vec4 v_color;\nout vec4 outColor;\nvoid main() {\n  outColor = v_color;\n}`,
  glyphVertex: `#version 300 es\nprecision mediump float;\nprecision mediump int;\nlayout(location = 0) in vec2 a_position;\nin vec2 a_texCoord;\nin vec4 a_color;\nout vec2 v_texCoord;\nout vec4 v_color;\nvoid main() {\n  v_texCoord = a_texCoord;\n  v_color = a_color;\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
  glyphFragment: `#version 300 es\nprecision mediump float;\nprecision mediump int;\nin vec2 v_texCoord;\nin vec4 v_color;\nuniform sampler2D u_texture;\nout vec4 outColor;\nvoid main() {\n  vec4 sample = texture(u_texture, v_texCoord);\n  outColor = vec4(sample.rgb * v_color.rgb, sample.a * v_color.a);\n}`,
  overlayVertex: `#version 300 es\nprecision mediump float;\nprecision mediump int;\nlayout(location = 0) in vec2 a_position;\nin vec2 a_texCoord;\nout vec2 v_texCoord;\nvoid main() {\n  v_texCoord = a_texCoord;\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
  overlayFragment: `#version 300 es\nprecision mediump float;\nprecision mediump int;\nin vec2 v_texCoord;\nuniform sampler2D u_overlay;\nout vec4 outColor;\nvoid main() {\n  outColor = texture(u_overlay, v_texCoord);\n}`,
}

const OVERLAY_POSITIONS = new Float32Array([
  -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
])

const OVERLAY_TEX_COORDS = new Float32Array([
  0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1,
])

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

const createDefaultAttributes = (): TerminalAttributes => ({
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
})

const DEFAULT_CELL: TerminalCell = {
  char: ' ',
  attr: createDefaultAttributes(),
  protected: false,
}

const updateBackendAttribute = (canvas: CanvasLike, backend: string): void => {
  if (typeof (canvas as HTMLCanvasElement).dataset === 'undefined') {
    return
  }
  ;(canvas as HTMLCanvasElement).dataset.manaRendererBackend = backend
}

const createShader = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to create WebGL shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    const shaderKind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
    const snippet = source.trim().split('\n').slice(0, 5).join('\n')
    const errorCode = gl.getError()
    gl.deleteShader(shader)
    throw new Error(
      `WebGL shader compilation failed (${shaderKind}): ${
        log && log.length > 0 ? log : 'unknown error'
      } (error code ${errorCode})\n${snippet}`,
    )
  }
  return shader
}

const createProgram = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error('Failed to create WebGL program')
  }
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error(`WebGL program link failed: ${log ?? 'unknown error'}`)
  }
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  return program
}

const createTexture = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): WebGLTexture => {
  const texture = gl.createTexture()
  if (!texture) {
    throw new Error('Failed to create WebGL texture')
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

const createTextureUploader = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  texture: WebGLTexture,
) => {
  let width = 0
  let height = 0
  return (source: CanvasLike, forceFullUpload: boolean) => {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    const nextWidth = source.width
    const nextHeight = source.height
    if (forceFullUpload || nextWidth !== width || nextHeight !== height) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source as unknown as TexImageSource,
      )
      width = nextWidth
      height = nextHeight
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source as unknown as TexImageSource,
      )
    }
  }
}

const releaseContext = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): void => {
  const loseContextExt = gl.getExtension('WEBGL_lose_context')
  if (loseContextExt) {
    loseContextExt.loseContext()
  }
}

const checkWebgl1Extensions = (
  gl: WebGLRenderingContext,
): ReadonlyArray<string> => {
  const missing: Array<string> = []
  for (const extension of WEBGL1_REQUIRED_EXTENSIONS) {
    if (!gl.getExtension(extension)) {
      missing.push(extension)
    }
  }
  return missing
}

const createOverlayCanvas = (): CanvasLike => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1) as unknown as CanvasLike
  }
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    return document.createElement('canvas') as unknown as CanvasLike
  }
  throw new Error('Unable to create overlay canvas')
}

const ensureOverlaySize = (
  canvas: CanvasLike,
  width: number,
  height: number,
): void => {
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  if (canvas.width !== w) {
    canvas.width = w
  }
  if (canvas.height !== h) {
    canvas.height = h
  }
}

interface FrameGeometry {
  readonly backgroundVertexCount: number
  readonly glyphVertexCount: number
  readonly glyphCount: number
}

interface BuildGeometryParams {
  readonly snapshot: TerminalState
  readonly metrics: RendererMetrics
  readonly theme: RendererTheme
  readonly paletteOverrides: PaletteOverrides
  readonly glyphAtlas: GlyphAtlas
  readonly colorCache: ColorCache
  readonly fallbackForeground: RendererColor
  readonly fallbackBackground: RendererColor
  readonly includeCursor: boolean
}

interface RowGeometry {
  readonly backgroundPositions: Float32Array
  readonly backgroundColors: Float32Array
  readonly glyphPositions: Float32Array
  readonly glyphTexCoords: Float32Array
  readonly glyphColors: Float32Array
  readonly backgroundVertexCount: number
  readonly glyphVertexCount: number
  readonly glyphCount: number
}

interface RowSliceEntry {
  readonly offset: number
  readonly length: number
}

interface RowSlice {
  readonly backgroundPositions: RowSliceEntry
  readonly backgroundColors: RowSliceEntry
  readonly glyphPositions: RowSliceEntry
  readonly glyphTexCoords: RowSliceEntry
  readonly glyphColors: RowSliceEntry
  backgroundVertexCount: number
  glyphVertexCount: number
  glyphCount: number
  version: number
}

class DynamicFloat32Array {
  private storage: Float32Array
  length: number

  constructor(initialCapacity = 1024) {
    this.storage = new Float32Array(initialCapacity)
    this.length = 0
  }

  reset(): void {
    this.length = 0
  }

  ensureCapacity(additional: number): void {
    const required = this.length + additional
    if (required <= this.storage.length) {
      return
    }
    let nextCapacity = this.storage.length || 1
    while (nextCapacity < required) {
      nextCapacity *= 2
    }
    const next = new Float32Array(nextCapacity)
    next.set(this.storage.subarray(0, this.length))
    this.storage = next
  }

  extend(count: number): number {
    this.ensureCapacity(count)
    const offset = this.length
    this.length += count
    return offset
  }

  get data(): Float32Array {
    return this.storage
  }

  view(): Float32Array {
    return this.storage.subarray(0, this.length)
  }

  get capacityBytes(): number {
    return this.storage.byteLength
  }
}

interface GeometryBuffers {
  readonly backgroundPositions: DynamicFloat32Array
  readonly backgroundColors: DynamicFloat32Array
  readonly glyphPositions: DynamicFloat32Array
  readonly glyphTexCoords: DynamicFloat32Array
  readonly glyphColors: DynamicFloat32Array
}

const createGeometryBuffers = (): GeometryBuffers => ({
  backgroundPositions: new DynamicFloat32Array(12 * 256),
  backgroundColors: new DynamicFloat32Array(24 * 256),
  glyphPositions: new DynamicFloat32Array(12 * 256),
  glyphTexCoords: new DynamicFloat32Array(12 * 256),
  glyphColors: new DynamicFloat32Array(24 * 256),
})

const resetGeometryBuffers = (buffers: GeometryBuffers): void => {
  buffers.backgroundPositions.reset()
  buffers.backgroundColors.reset()
  buffers.glyphPositions.reset()
  buffers.glyphTexCoords.reset()
  buffers.glyphColors.reset()
}

const buildRowGeometry = (
  context: BuildGeometryParams,
  options: {
    readonly row: number
    readonly toClipX: (value: number) => number
    readonly toClipY: (value: number) => number
    readonly selectionSegment: SelectionRowSegment | null
    readonly selectionTheme: RendererTheme['selection'] | undefined
  },
): RowGeometry => {
  const {
    snapshot,
    metrics,
    theme,
    paletteOverrides,
    glyphAtlas,
    colorCache,
    fallbackForeground,
    fallbackBackground,
    includeCursor,
  } = context
  const { row, toClipX, toClipY, selectionSegment, selectionTheme } = options

  const cellWidth = metrics.cell.width
  const cellHeight = metrics.cell.height
  const rowY = row * cellHeight

  let backgroundVertexCount = 0
  let glyphVertexCount = 0
  let glyphCount = 0

  const backgroundPositions: number[] = []
  const backgroundColors: number[] = []
  const glyphPositions: number[] = []
  const glyphTexCoords: number[] = []
  const glyphColors: number[] = []

  const pushBackgroundQuad = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: RendererColor,
    alphaMultiplier = 1,
  ) => {
    const [r, g, b, baseAlpha] = colorCache.get(color)
    const alpha = baseAlpha * alphaMultiplier
    if (alpha <= 0) {
      return
    }

    const x1 = toClipX(x)
    const x2 = toClipX(x + width)
    const y1 = toClipY(y + height)
    const y2 = toClipY(y)

    backgroundPositions.push(
      x1,
      y1,
      x2,
      y1,
      x1,
      y2,
      x1,
      y2,
      x2,
      y1,
      x2,
      y2,
    )

    for (let index = 0; index < 6; index += 1) {
      backgroundColors.push(r, g, b, alpha)
    }

    backgroundVertexCount += 6
  }

  const pushGlyphQuad = (
    x: number,
    y: number,
    glyph: GlyphInfo,
    color: RendererColor,
    alphaMultiplier: number,
  ) => {
    const [r, g, b, baseAlpha] = colorCache.get(color)
    const alpha = baseAlpha * alphaMultiplier
    if (alpha <= 0) {
      return
    }

    const x1 = toClipX(x)
    const x2 = toClipX(x + glyph.width)
    const y1 = toClipY(y + glyph.height)
    const y2 = toClipY(y)

    glyphPositions.push(
      x1,
      y1,
      x2,
      y1,
      x1,
      y2,
      x1,
      y2,
      x2,
      y1,
      x2,
      y2,
    )

    glyphTexCoords.push(
      glyph.u1,
      glyph.v1,
      glyph.u2,
      glyph.v1,
      glyph.u1,
      glyph.v2,
      glyph.u1,
      glyph.v2,
      glyph.u2,
      glyph.v1,
      glyph.u2,
      glyph.v2,
    )

    for (let index = 0; index < 6; index += 1) {
      glyphColors.push(r, g, b, alpha)
    }

    glyphVertexCount += 6
    glyphCount += 1
  }

  if (selectionSegment && selectionTheme?.background) {
    const highlightX = selectionSegment.startColumn * cellWidth
    const highlightWidth =
      (selectionSegment.endColumn - selectionSegment.startColumn + 1) *
      cellWidth
    pushBackgroundQuad(
      highlightX,
      rowY,
      highlightWidth,
      cellHeight,
      selectionTheme.background,
    )
  }

  const bufferRow = snapshot.buffer[row]

  for (let column = 0; column < snapshot.columns; column += 1) {
    const cell = bufferRow?.[column] ?? DEFAULT_CELL
    const x = column * cellWidth
    const isSelected =
      selectionSegment !== null &&
      column >= selectionSegment.startColumn &&
      column <= selectionSegment.endColumn

    const { foreground, background } = resolveCellColors(
      cell.attr,
      theme,
      paletteOverrides,
      fallbackForeground,
      fallbackBackground,
    )

    let effectiveForeground = foreground
    let effectiveBackground = background

    if (isSelected) {
      if (selectionTheme?.foreground) {
        effectiveForeground = selectionTheme.foreground
      }
      effectiveBackground = null
    }

    if (effectiveBackground) {
      pushBackgroundQuad(x, rowY, cellWidth, cellHeight, effectiveBackground)
    }

    if (effectiveForeground) {
      if (cell.attr.underline !== 'none') {
        const thickness = Math.max(1, Math.round(cellHeight * 0.08))
        const baseY = rowY + cellHeight - thickness
        pushBackgroundQuad(
          x,
          baseY,
          cellWidth,
          thickness,
          effectiveForeground,
        )
        if (cell.attr.underline === 'double') {
          const gap = thickness + 2
          const secondY = Math.max(rowY, baseY - gap)
          pushBackgroundQuad(
            x,
            secondY,
            cellWidth,
            thickness,
            effectiveForeground,
          )
        }
      }

      if (cell.attr.strikethrough) {
        const thickness = Math.max(1, Math.round(cellHeight * 0.08))
        const strikeY = rowY + Math.round(cellHeight / 2) - Math.floor(thickness / 2)
        pushBackgroundQuad(
          x,
          strikeY,
          cellWidth,
          thickness,
          effectiveForeground,
        )
      }
    }

    const char = cell.char
    const shouldDrawGlyph = Boolean(
      effectiveForeground && char && char !== ' ',
    )

    if (shouldDrawGlyph && effectiveForeground) {
      const glyph = glyphAtlas.getGlyph(char!, {
        bold: Boolean(cell.attr.bold),
        italic: Boolean(cell.attr.italic),
      })
      const alphaMultiplier = cell.attr.faint ? 0.6 : 1
      pushGlyphQuad(x, rowY, glyph, effectiveForeground, alphaMultiplier)
    }
  }

  if (
    includeCursor &&
    snapshot.cursorVisible &&
    snapshot.cursor.row === row
  ) {
    const cursor = snapshot.cursor
    const cursorTheme = theme.cursor
    const cursorShape = cursorTheme.shape ?? 'block'
    const cursorOpacity = cursorTheme.opacity ?? 1
    const cursorColor = cursorTheme.color
    const x = cursor.column * cellWidth

    switch (cursorShape) {
      case 'underline': {
        const height = Math.max(1, Math.round(cellHeight * 0.2))
        pushBackgroundQuad(
          x,
          rowY + cellHeight - height,
          cellWidth,
          height,
          cursorColor,
          cursorOpacity,
        )
        break
      }
      case 'bar': {
        const width = Math.max(1, Math.round(cellWidth * 0.2))
        pushBackgroundQuad(
          x,
          rowY,
          width,
          cellHeight,
          cursorColor,
          cursorOpacity,
        )
        break
      }
      case 'block':
      default: {
        pushBackgroundQuad(
          x,
          rowY,
          cellWidth,
          cellHeight,
          cursorColor,
          cursorOpacity,
        )
        break
      }
    }
  }

  const toFloat32 = (values: number[]): Float32Array =>
    values.length > 0 ? new Float32Array(values) : new Float32Array(0)

  return {
    backgroundPositions: toFloat32(backgroundPositions),
    backgroundColors: toFloat32(backgroundColors),
    glyphPositions: toFloat32(glyphPositions),
    glyphTexCoords: toFloat32(glyphTexCoords),
    glyphColors: toFloat32(glyphColors),
    backgroundVertexCount,
    glyphVertexCount,
    glyphCount,
  }
}

export const __buildRowGeometryForTests = buildRowGeometry

export interface WebglSupportOptions {
  readonly canvas?: CanvasLike
  readonly contextAttributes?: WebGLContextAttributes
}

export interface WebglSupportResult {
  readonly kind: 'gpu-webgl'
  readonly supported: boolean
  readonly contextKind: 'webgl2' | 'webgl' | null
  readonly missingExtensions: ReadonlyArray<string>
  readonly reason?: string
}

const createDetectionCanvas = (
  options?: WebglSupportOptions,
): CanvasLike | null => {
  if (options?.canvas) {
    return options.canvas
  }
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    return document.createElement('canvas') as unknown as CanvasLike
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1) as unknown as CanvasLike
  }
  return null
}

export const detectWebglSupport = (
  options?: WebglSupportOptions,
): WebglSupportResult => {
  const canvas = createDetectionCanvas(options)
  if (!canvas) {
    return {
      kind: 'gpu-webgl',
      supported: false,
      contextKind: null,
      missingExtensions: [],
      reason: 'No canvas available for WebGL detection',
    }
  }

  const attributes = options?.contextAttributes ?? DEFAULT_CONTEXT_ATTRIBUTES

  const webgl2 = canvas.getContext('webgl2', attributes as never)
  if (webgl2) {
    releaseContext(webgl2)
    return {
      kind: 'gpu-webgl',
      supported: true,
      contextKind: 'webgl2',
      missingExtensions: [],
    }
  }

  const webgl1 =
    (canvas.getContext(
      'webgl',
      attributes as never,
    ) as WebGLRenderingContext | null) ??
    (canvas.getContext(
      'experimental-webgl',
      attributes as never,
    ) as WebGLRenderingContext | null)

  if (!webgl1) {
    return {
      kind: 'gpu-webgl',
      supported: false,
      contextKind: null,
      missingExtensions: [],
      reason: 'Unable to create a WebGL context',
    }
  }

  const missingExtensions = checkWebgl1Extensions(webgl1)
  releaseContext(webgl1)

  if (missingExtensions.length > 0) {
    return {
      kind: 'gpu-webgl',
      supported: false,
      contextKind: 'webgl',
      missingExtensions,
      reason: `Missing required extensions: ${missingExtensions.join(', ')}`,
    }
  }

  return {
    kind: 'gpu-webgl',
    supported: true,
    contextKind: 'webgl',
    missingExtensions: [],
  }
}

export type WebglInitOutcome =
  | {
      readonly success: true
      readonly renderer: CanvasRenderer
      readonly support: WebglSupportResult
    }
  | {
      readonly success: false
      readonly reason?: string
      readonly support: WebglSupportResult
    }

const createWebglContext = (
  canvas: CanvasLike,
  contextKind: 'webgl2' | 'webgl',
  attributes?: WebGLContextAttributes,
): WebGLRenderingContext | WebGL2RenderingContext | null => {
  const mergedAttributes = {
    ...DEFAULT_CONTEXT_ATTRIBUTES,
    ...(attributes ?? {}),
  }
  if (contextKind === 'webgl2') {
    return canvas.getContext(
      'webgl2',
      mergedAttributes as never,
    ) as WebGL2RenderingContext | null
  }
  return canvas.getContext(
    'webgl',
    mergedAttributes as never,
  ) as WebGLRenderingContext | null
}

interface GpuFrameMetrics {
  readonly frameDuration: number
  readonly drawCalls: number
  readonly cellsProcessed: number | null
  readonly bytesUploaded: number | null
  readonly dirtyRegionCoverage: number | null
  readonly overlayBytesUploaded: number | null
}

const updateDiagnostics = (
  diagnostics: CanvasRendererDiagnostics,
  metrics: GpuFrameMetrics,
): CanvasRendererDiagnostics => ({
  ...diagnostics,
  lastFrameDurationMs: metrics.frameDuration,
  lastDrawCallCount: metrics.drawCalls,
  gpuFrameDurationMs: metrics.frameDuration,
  gpuDrawCallCount: metrics.drawCalls,
  gpuCellsProcessed: metrics.cellsProcessed,
  gpuBytesUploaded: metrics.bytesUploaded,
  gpuDirtyRegionCoverage: metrics.dirtyRegionCoverage,
  gpuOverlayBytesUploaded: metrics.overlayBytesUploaded,
})

interface GlBufferState {
  capacityBytes: number
}

const createGlBufferState = (): GlBufferState => ({ capacityBytes: 0 })

const ensureArrayBufferCapacity = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  target: GLenum,
  state: GlBufferState,
  requiredBytes: number,
) => {
  if (requiredBytes <= 0) {
    return
  }
  if (state.capacityBytes !== requiredBytes) {
    gl.bufferData(target, requiredBytes, gl.DYNAMIC_DRAW)
    state.capacityBytes = requiredBytes
  }
}

const createWebglRenderer = (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  options: CanvasRendererOptions,
  support: WebglSupportResult,
): CanvasRenderer => {
  const shaders =
    support.contextKind === 'webgl2' ? SHADERS_WEBGL2 : SHADERS_WEBGL1
  const paletteOverrides: PaletteOverrides = new Map()
  const glyphAtlas = new GlyphAtlas({ metrics: options.metrics })
  const colorCache = new ColorCache()
  const canvas = options.canvas
  const customCursorOverlay = options.cursorOverlayStrategy
  const overlayCanvas = customCursorOverlay ? createOverlayCanvas() : null
  const overlayCtx = overlayCanvas
    ? ((overlayCanvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
      }) as CanvasRenderingContext2D | null) ?? undefined)
    : undefined

  if (customCursorOverlay && !overlayCtx) {
    throw new Error('Unable to create 2D context for custom cursor overlay')
  }

  const backgroundProgram = createProgram(
    gl,
    shaders.backgroundVertex,
    shaders.backgroundFragment,
  )
  const backgroundPositionLocation = gl.getAttribLocation(
    backgroundProgram,
    support.contextKind === 'webgl2' ? 'a_position' : 'a_position',
  )
  const backgroundColorLocation = gl.getAttribLocation(
    backgroundProgram,
    support.contextKind === 'webgl2' ? 'a_color' : 'a_color',
  )

  const glyphProgram = createProgram(
    gl,
    shaders.glyphVertex,
    shaders.glyphFragment,
  )
  const glyphPositionLocation = gl.getAttribLocation(glyphProgram, 'a_position')
  const glyphTexCoordLocation = gl.getAttribLocation(glyphProgram, 'a_texCoord')
  const glyphColorLocation = gl.getAttribLocation(glyphProgram, 'a_color')
  const glyphTextureLocation = gl.getUniformLocation(glyphProgram, 'u_texture')

  const overlayProgram = customCursorOverlay
    ? createProgram(gl, shaders.overlayVertex, shaders.overlayFragment)
    : null
  const overlayPositionLocation = overlayProgram
    ? gl.getAttribLocation(overlayProgram, 'a_position')
    : -1
  const overlayTexCoordLocation = overlayProgram
    ? gl.getAttribLocation(overlayProgram, 'a_texCoord')
    : -1
  const overlayTextureLocation = overlayProgram
    ? gl.getUniformLocation(overlayProgram, 'u_overlay')
    : null

  const backgroundPositionBuffer = gl.createBuffer()
  const backgroundColorBuffer = gl.createBuffer()
  const glyphPositionBuffer = gl.createBuffer()
  const glyphTexCoordBuffer = gl.createBuffer()
  const glyphColorBuffer = gl.createBuffer()
  const overlayPositionBuffer = overlayProgram ? gl.createBuffer() : null
  const overlayTexCoordBuffer = overlayProgram ? gl.createBuffer() : null

  if (
    !backgroundPositionBuffer ||
    !backgroundColorBuffer ||
    !glyphPositionBuffer ||
    !glyphTexCoordBuffer ||
    !glyphColorBuffer
  ) {
    throw new Error('Failed to allocate WebGL buffers')
  }

  if (overlayProgram && (!overlayPositionBuffer || !overlayTexCoordBuffer)) {
    throw new Error('Failed to allocate overlay buffers')
  }

  if (overlayProgram && overlayPositionBuffer && overlayTexCoordBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, overlayPositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, OVERLAY_POSITIONS, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, overlayTexCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, OVERLAY_TEX_COORDS, gl.STATIC_DRAW)
  }

  const geometryBuffers = createGeometryBuffers()

  const glyphTexture = createTexture(gl)
  const uploadGlyphTexture = createTextureUploader(gl, glyphTexture)

  const overlayTexture = overlayProgram ? createTexture(gl) : null
  const uploadOverlayTexture = overlayTexture
    ? createTextureUploader(gl, overlayTexture)
    : null

  const backgroundPositionBufferState = createGlBufferState()
  const backgroundColorBufferState = createGlBufferState()
  const glyphPositionBufferState = createGlBufferState()
  const glyphTexCoordBufferState = createGlBufferState()
  const glyphColorBufferState = createGlBufferState()
  const dirtyTracker = new DirtyRegionTracker()
  const rowGeometries: Array<RowGeometry | null> = []
  const rowSlices: Array<RowSlice | null> = []

  let totalBackgroundVertexCount = 0
  let totalGlyphVertexCount = 0
  let totalGlyphCount = 0
  let buffersInitialized = false
  let sliceVersionCounter = 0
  let totalsNeedRecompute = false

  const nextSliceVersion = (): number => {
    sliceVersionCounter = (sliceVersionCounter + 1) % Number.MAX_SAFE_INTEGER
    if (sliceVersionCounter === 0) {
      sliceVersionCounter = 1
    }
    return sliceVersionCounter
  }

  const recomputeTotals = (): void => {
    totalBackgroundVertexCount = 0
    totalGlyphVertexCount = 0
    totalGlyphCount = 0
    for (const slice of rowSlices) {
      if (!slice) {
        continue
      }
      totalBackgroundVertexCount += slice.backgroundVertexCount
      totalGlyphVertexCount += slice.glyphVertexCount
      totalGlyphCount += slice.glyphCount
    }
  }

  let disposed = false
  let metrics = options.metrics
  let theme = options.theme
  let currentSnapshot = options.snapshot
  let currentSelection: TerminalSelection | null =
    options.snapshot.selection ?? null
  let selectionListener = options.onSelectionChange
  let diagnostics: CanvasRendererDiagnostics = {
    lastFrameDurationMs: null,
    lastDrawCallCount: null,
    gpuFrameDurationMs: null,
    gpuDrawCallCount: null,
    gpuCellsProcessed: null,
    gpuBytesUploaded: null,
    gpuDirtyRegionCoverage: null,
    gpuOverlayBytesUploaded: null,
    lastOsc: null,
    lastSosPmApc: null,
    lastDcs: null,
  }

  let pendingDcs: {
    readonly finalByte: number
    readonly params: ReadonlyArray<number>
    readonly intermediates: ReadonlyArray<number>
    data: string
  } | null = null

  const consumeSelectionChange = (selection: TerminalSelection | null) => {
    currentSelection = selection
    selectionListener?.(selection)
  }

  updateBackendAttribute(canvas, 'gpu-webgl')
  dirtyTracker.markFull()

  const trimRowStorage = (rowCount: number): void => {
    if (rowGeometries.length > rowCount) {
      rowGeometries.length = rowCount
    }
    if (rowSlices.length > rowCount) {
      rowSlices.length = rowCount
    }
  }

  const ensureRowStorage = (rowCount: number): void => {
    while (rowGeometries.length < rowCount) {
      rowGeometries.push(null)
    }
    while (rowSlices.length < rowCount) {
      rowSlices.push(null)
    }
  }

  const translateRowSliceInBuffers = (
    slice: RowSlice,
    deltaClip: number,
  ): void => {
    if (slice.backgroundPositions.length > 0) {
      const { offset, length } = slice.backgroundPositions
      const data = geometryBuffers.backgroundPositions.data
      for (let i = 1; i < length; i += 2) {
        const idx = offset + i
        const current = data[idx] ?? 0
        data[idx] = current + deltaClip
      }
    }
    if (slice.glyphPositions.length > 0) {
      const { offset, length } = slice.glyphPositions
      const data = geometryBuffers.glyphPositions.data
      for (let i = 1; i < length; i += 2) {
        const idx = offset + i
        const current = data[idx] ?? 0
        data[idx] = current + deltaClip
      }
    }
  }

  const translateRowGeometryArrays = (
    geometry: RowGeometry,
    deltaClip: number,
  ): void => {
    if (geometry.backgroundPositions.length > 0) {
      for (let index = 1; index < geometry.backgroundPositions.length; index += 2) {
        const value = geometry.backgroundPositions[index] ?? 0
        geometry.backgroundPositions[index] = value + deltaClip
      }
    }
    if (geometry.glyphPositions.length > 0) {
      for (let index = 1; index < geometry.glyphPositions.length; index += 2) {
        const value = geometry.glyphPositions[index] ?? 0
        geometry.glyphPositions[index] = value + deltaClip
      }
    }
  }

  const allocateRowSlice = (rowGeometry: RowGeometry): RowSlice => {
    let backgroundOffset = 0
    if (rowGeometry.backgroundPositions.length > 0) {
      backgroundOffset = geometryBuffers.backgroundPositions.extend(
        rowGeometry.backgroundPositions.length,
      )
      geometryBuffers.backgroundPositions.data.set(
        rowGeometry.backgroundPositions,
        backgroundOffset,
      )
    }

    let backgroundColorOffset = 0
    if (rowGeometry.backgroundColors.length > 0) {
      backgroundColorOffset = geometryBuffers.backgroundColors.extend(
        rowGeometry.backgroundColors.length,
      )
      geometryBuffers.backgroundColors.data.set(
        rowGeometry.backgroundColors,
        backgroundColorOffset,
      )
    }

    let glyphPositionOffset = 0
    if (rowGeometry.glyphPositions.length > 0) {
      glyphPositionOffset = geometryBuffers.glyphPositions.extend(
        rowGeometry.glyphPositions.length,
      )
      geometryBuffers.glyphPositions.data.set(
        rowGeometry.glyphPositions,
        glyphPositionOffset,
      )
    }

    let glyphTexCoordOffset = 0
    if (rowGeometry.glyphTexCoords.length > 0) {
      glyphTexCoordOffset = geometryBuffers.glyphTexCoords.extend(
        rowGeometry.glyphTexCoords.length,
      )
      geometryBuffers.glyphTexCoords.data.set(
        rowGeometry.glyphTexCoords,
        glyphTexCoordOffset,
      )
    }

    let glyphColorOffset = 0
    if (rowGeometry.glyphColors.length > 0) {
      glyphColorOffset = geometryBuffers.glyphColors.extend(
        rowGeometry.glyphColors.length,
      )
      geometryBuffers.glyphColors.data.set(
        rowGeometry.glyphColors,
        glyphColorOffset,
      )
    }

    totalBackgroundVertexCount += rowGeometry.backgroundVertexCount
    totalGlyphVertexCount += rowGeometry.glyphVertexCount
    totalGlyphCount += rowGeometry.glyphCount
    totalsNeedRecompute = true

    return {
      backgroundPositions: {
        offset: backgroundOffset,
        length: rowGeometry.backgroundPositions.length,
      },
      backgroundColors: {
        offset: backgroundColorOffset,
        length: rowGeometry.backgroundColors.length,
      },
      glyphPositions: {
        offset: glyphPositionOffset,
        length: rowGeometry.glyphPositions.length,
      },
      glyphTexCoords: {
        offset: glyphTexCoordOffset,
        length: rowGeometry.glyphTexCoords.length,
      },
      glyphColors: {
        offset: glyphColorOffset,
        length: rowGeometry.glyphColors.length,
      },
      backgroundVertexCount: rowGeometry.backgroundVertexCount,
      glyphVertexCount: rowGeometry.glyphVertexCount,
      glyphCount: rowGeometry.glyphCount,
      version: nextSliceVersion(),
    }
  }

  const performFullRebuild = (
    geometryContext: BuildGeometryParams,
    selectionByRow: Map<number, SelectionRowSegment>,
    selectionTheme: RendererTheme['selection'] | undefined,
    toClipX: (value: number) => number,
    toClipY: (value: number) => number,
  ) => {
    const { snapshot } = geometryContext
    trimRowStorage(snapshot.rows)
    ensureRowStorage(snapshot.rows)

    resetGeometryBuffers(geometryBuffers)

    totalBackgroundVertexCount = 0
    totalGlyphVertexCount = 0
    totalGlyphCount = 0

    for (let row = 0; row < snapshot.rows; row += 1) {
      const selectionSegment = selectionByRow.get(row) ?? null
      const rowGeometry = buildRowGeometry(geometryContext, {
        row,
        toClipX,
        toClipY,
        selectionSegment,
        selectionTheme,
      })

      rowGeometries[row] = rowGeometry

      const backgroundLength = rowGeometry.backgroundPositions.length
      const backgroundColorLength = rowGeometry.backgroundColors.length
      const glyphPositionLength = rowGeometry.glyphPositions.length
      const glyphTexCoordLength = rowGeometry.glyphTexCoords.length
      const glyphColorLength = rowGeometry.glyphColors.length

      let backgroundOffset = 0
      if (backgroundLength > 0) {
        backgroundOffset = geometryBuffers.backgroundPositions.extend(
          backgroundLength,
        )
        geometryBuffers.backgroundPositions.data.set(
          rowGeometry.backgroundPositions,
          backgroundOffset,
        )
      }

      let backgroundColorOffset = 0
      if (backgroundColorLength > 0) {
        backgroundColorOffset = geometryBuffers.backgroundColors.extend(
          backgroundColorLength,
        )
        geometryBuffers.backgroundColors.data.set(
          rowGeometry.backgroundColors,
          backgroundColorOffset,
        )
      }

      let glyphPositionOffset = 0
      if (glyphPositionLength > 0) {
        glyphPositionOffset = geometryBuffers.glyphPositions.extend(
          glyphPositionLength,
        )
        geometryBuffers.glyphPositions.data.set(
          rowGeometry.glyphPositions,
          glyphPositionOffset,
        )
      }

      let glyphTexCoordOffset = 0
      if (glyphTexCoordLength > 0) {
        glyphTexCoordOffset = geometryBuffers.glyphTexCoords.extend(
          glyphTexCoordLength,
        )
        geometryBuffers.glyphTexCoords.data.set(
          rowGeometry.glyphTexCoords,
          glyphTexCoordOffset,
        )
      }

      let glyphColorOffset = 0
      if (glyphColorLength > 0) {
        glyphColorOffset = geometryBuffers.glyphColors.extend(glyphColorLength)
        geometryBuffers.glyphColors.data.set(
          rowGeometry.glyphColors,
          glyphColorOffset,
        )
      }

      rowSlices[row] = {
        backgroundPositions: { offset: backgroundOffset, length: backgroundLength },
        backgroundColors: {
          offset: backgroundColorOffset,
          length: backgroundColorLength,
        },
        glyphPositions: { offset: glyphPositionOffset, length: glyphPositionLength },
        glyphTexCoords: {
          offset: glyphTexCoordOffset,
          length: glyphTexCoordLength,
        },
        glyphColors: { offset: glyphColorOffset, length: glyphColorLength },
        backgroundVertexCount: rowGeometry.backgroundVertexCount,
        glyphVertexCount: rowGeometry.glyphVertexCount,
        glyphCount: rowGeometry.glyphCount,
        version: nextSliceVersion(),
      }

      totalBackgroundVertexCount += rowGeometry.backgroundVertexCount
      totalGlyphVertexCount += rowGeometry.glyphVertexCount
      totalGlyphCount += rowGeometry.glyphCount
    }

    const geometry: FrameGeometry = {
      backgroundVertexCount: totalBackgroundVertexCount,
      glyphVertexCount: totalGlyphVertexCount,
      glyphCount: totalGlyphCount,
    }
    totalsNeedRecompute = false

    return {
      geometry,
      backgroundPositionsView:
        geometryBuffers.backgroundPositions.view() as Float32Array<ArrayBufferLike>,
      backgroundColorsView:
        geometryBuffers.backgroundColors.view() as Float32Array<ArrayBufferLike>,
      glyphPositionsView:
        geometryBuffers.glyphPositions.view() as Float32Array<ArrayBufferLike>,
      glyphTexCoordsView:
        geometryBuffers.glyphTexCoords.view() as Float32Array<ArrayBufferLike>,
      glyphColorsView:
        geometryBuffers.glyphColors.view() as Float32Array<ArrayBufferLike>,
    }
  }

  const handleScrollUpdate = (
    amount: number,
    previousSnapshot: TerminalState,
    nextSnapshot: TerminalState,
  ): boolean => {
    if (!buffersInitialized) {
      return false
    }
    if (amount === 0) {
      return true
    }
    if (previousSnapshot.rows !== nextSnapshot.rows) {
      return false
    }
    const start = Math.max(0, nextSnapshot.scrollTop)
    const end = Math.min(
      nextSnapshot.scrollBottom,
      Math.max(0, nextSnapshot.rows - 1),
    )
    if (start > end) {
      return false
    }
    // Limit heuristics to full-viewport scrolls for now.
    if (start !== 0 || end !== nextSnapshot.rows - 1) {
      return false
    }
    const regionHeight = end - start + 1
    if (regionHeight <= 0 || Math.abs(amount) >= regionHeight) {
      return false
    }

    const clipPerRow = nextSnapshot.rows > 0 ? 2 / nextSnapshot.rows : 0
    if (clipPerRow === 0) {
      return false
    }

    const oldSlices = rowSlices.slice()
    const oldGeometries = rowGeometries.slice()
    const newSlices = rowSlices.slice()
    const newGeometries = rowGeometries.slice()
    const rowsNeedingRebuild: Array<number> = []

    if (amount > 0) {
      for (let target = start; target <= end; target += 1) {
        const source = target + amount
        if (source <= end) {
          const slice = oldSlices[source] ?? null
          const geometry = oldGeometries[source] ?? null
          if (slice && geometry) {
            const deltaRows = target - source
            const deltaClip = -deltaRows * clipPerRow
            translateRowSliceInBuffers(slice, deltaClip)
            translateRowGeometryArrays(geometry, deltaClip)
            slice.version = nextSliceVersion()
            newSlices[target] = slice
            newGeometries[target] = geometry
          } else {
            newSlices[target] = null
            newGeometries[target] = null
            rowsNeedingRebuild.push(target)
          }
        } else {
          newSlices[target] = null
          newGeometries[target] = null
          rowsNeedingRebuild.push(target)
        }
        if (target + amount <= end && target + amount >= start) {
          newSlices[target + amount] = null
          newGeometries[target + amount] = null
        }
      }
    } else {
      for (let target = end; target >= start; target -= 1) {
        const source = target + amount
        if (source >= start) {
          const slice = oldSlices[source] ?? null
          const geometry = oldGeometries[source] ?? null
          if (slice && geometry) {
            const deltaRows = target - source
            const deltaClip = -deltaRows * clipPerRow
            translateRowSliceInBuffers(slice, deltaClip)
            translateRowGeometryArrays(geometry, deltaClip)
            slice.version = nextSliceVersion()
            newSlices[target] = slice
            newGeometries[target] = geometry
          } else {
            newSlices[target] = null
            newGeometries[target] = null
            rowsNeedingRebuild.push(target)
          }
        } else {
          newSlices[target] = null
          newGeometries[target] = null
          rowsNeedingRebuild.push(target)
        }
        if (target + amount >= start && target + amount <= end) {
          newSlices[target + amount] = null
          newGeometries[target + amount] = null
        }
      }
    }

    for (let row = start; row <= end; row += 1) {
      rowSlices[row] = newSlices[row] ?? null
      rowGeometries[row] = newGeometries[row] ?? null
    }

    for (const row of rowsNeedingRebuild) {
      rowSlices[row] = null
      rowGeometries[row] = null
      dirtyTracker.markRange(row, 0, nextSnapshot.columns - 1)
    }

    totalsNeedRecompute = true
    return true
  }
  const renderSnapshot = (snapshot: TerminalState): void => {
    const layout = ensureCanvasDimensions(canvas, snapshot, metrics)
    setCanvasStyleSize(canvas, layout)

    const reverseVideo = Boolean(snapshot.reverseVideo)
    const fallbackForeground = reverseVideo
      ? theme.background
      : theme.foreground
    const fallbackBackground = reverseVideo
      ? theme.foreground
      : theme.background

    const cellWidth = metrics.cell.width
    const cellHeight = metrics.cell.height
    const logicalWidth = Math.max(1, snapshot.columns * cellWidth)
    const logicalHeight = Math.max(1, snapshot.rows * cellHeight)
    const toClipX = (value: number): number => (value / logicalWidth) * 2 - 1
    const toClipY = (value: number): number => 1 - (value / logicalHeight) * 2

    const selection = snapshot.selection ?? null
    const selectionTheme = theme.selection
    const selectionSegments = selection
      ? getSelectionRowSegments(selection, snapshot.columns)
      : []
    const selectionByRow = new Map<number, SelectionRowSegment>()
    for (const segment of selectionSegments) {
      selectionByRow.set(segment.row, segment)
    }

    trimRowStorage(snapshot.rows)
    ensureRowStorage(snapshot.rows)

    const geometryContext: BuildGeometryParams = {
      snapshot,
      metrics,
      theme,
      paletteOverrides,
      glyphAtlas,
      colorCache,
      fallbackForeground,
      fallbackBackground,
      includeCursor: !customCursorOverlay,
    }

    const dirtyResult = dirtyTracker.consume(snapshot.rows, snapshot.columns)
    const rebuildAll = dirtyResult.mode === 'full'
    const rowsToRebuild = new Set<number>()
    if (rebuildAll) {
      for (let row = 0; row < snapshot.rows; row += 1) {
        rowsToRebuild.add(row)
      }
    } else if (dirtyResult.mode === 'partial') {
      for (const row of dirtyResult.rows.keys()) {
        rowsToRebuild.add(row)
      }
    }

    for (let row = 0; row < snapshot.rows; row += 1) {
      if (rowSlices[row] === null) {
        rowsToRebuild.add(row)
      }
    }

    const rowsToRebuildArray = Array.from(rowsToRebuild.values()).sort(
      (a, b) => a - b,
    )

    let geometry: FrameGeometry
    let backgroundPositionsView: Float32Array<ArrayBufferLike> =
      new Float32Array(0)
    let backgroundColorsView: Float32Array<ArrayBufferLike> =
      new Float32Array(0)
    let glyphPositionsView: Float32Array<ArrayBufferLike> =
      new Float32Array(0)
    let glyphTexCoordsView: Float32Array<ArrayBufferLike> =
      new Float32Array(0)
    let glyphColorsView: Float32Array<ArrayBufferLike> = new Float32Array(0)
    let fullRebuildPerformed = false

    const pendingRowGeometry = new Map<
      number,
      { geometry: RowGeometry; expectedVersion: number | null }
    >()
    let requiresFullRebuild = rebuildAll

    if (!requiresFullRebuild) {
      for (const row of rowsToRebuildArray) {
        const rowGeometry = buildRowGeometry(geometryContext, {
          row,
          toClipX,
          toClipY,
          selectionSegment: selectionByRow.get(row) ?? null,
          selectionTheme,
        })
        const slice = rowSlices[row] ?? null
        pendingRowGeometry.set(row, {
          geometry: rowGeometry,
          expectedVersion: slice ? slice.version : null,
        })
        if (
          slice !== null &&
          (rowGeometry.backgroundPositions.length !==
            slice.backgroundPositions.length ||
            rowGeometry.backgroundColors.length !==
              slice.backgroundColors.length ||
            rowGeometry.glyphPositions.length !==
              slice.glyphPositions.length ||
            rowGeometry.glyphTexCoords.length !==
              slice.glyphTexCoords.length ||
            rowGeometry.glyphColors.length !== slice.glyphColors.length)
        ) {
          requiresFullRebuild = true
          break
        }
      }
    }

    const backgroundPositionUpdates: Array<{
      offset: number
      data: Float32Array<ArrayBufferLike>
    }> = []
    const backgroundColorUpdates: Array<{
      offset: number
      data: Float32Array<ArrayBufferLike>
    }> = []
    const glyphPositionUpdates: Array<{
      offset: number
      data: Float32Array<ArrayBufferLike>
    }> = []
    const glyphTexCoordUpdates: Array<{
      offset: number
      data: Float32Array<ArrayBufferLike>
    }> = []
    const glyphColorUpdates: Array<{
      offset: number
      data: Float32Array<ArrayBufferLike>
    }> = []

    if (requiresFullRebuild) {
      const rebuildResult = performFullRebuild(
        geometryContext,
        selectionByRow,
        selectionTheme,
        toClipX,
        toClipY,
      )
      geometry = rebuildResult.geometry
      backgroundPositionsView = rebuildResult.backgroundPositionsView
      backgroundColorsView = rebuildResult.backgroundColorsView
      glyphPositionsView = rebuildResult.glyphPositionsView
      glyphTexCoordsView = rebuildResult.glyphTexCoordsView
      glyphColorsView = rebuildResult.glyphColorsView
      fullRebuildPerformed = true
    } else {
      let fallbackToFull = false
      for (const row of rowsToRebuildArray) {
        const entry = pendingRowGeometry.get(row)!
        const rowGeometry = entry.geometry
        const slice = rowSlices[row] ?? null

        if (slice !== null) {
          const currentSlice: RowSlice = slice
          if (
            entry.expectedVersion !== null &&
            currentSlice.version !== entry.expectedVersion
          ) {
            fallbackToFull = true
            break
          }

          if (rowGeometry.backgroundPositions.length > 0) {
            geometryBuffers.backgroundPositions.data.set(
              rowGeometry.backgroundPositions,
              currentSlice.backgroundPositions.offset,
            )
            backgroundPositionUpdates.push({
              offset: currentSlice.backgroundPositions.offset,
              data: rowGeometry.backgroundPositions,
            })
          }
          if (rowGeometry.backgroundColors.length > 0) {
            geometryBuffers.backgroundColors.data.set(
              rowGeometry.backgroundColors,
              currentSlice.backgroundColors.offset,
            )
            backgroundColorUpdates.push({
              offset: currentSlice.backgroundColors.offset,
              data: rowGeometry.backgroundColors,
            })
          }
          if (rowGeometry.glyphPositions.length > 0) {
            geometryBuffers.glyphPositions.data.set(
              rowGeometry.glyphPositions,
              currentSlice.glyphPositions.offset,
            )
            glyphPositionUpdates.push({
              offset: currentSlice.glyphPositions.offset,
              data: rowGeometry.glyphPositions,
            })
          }
          if (rowGeometry.glyphTexCoords.length > 0) {
            geometryBuffers.glyphTexCoords.data.set(
              rowGeometry.glyphTexCoords,
              currentSlice.glyphTexCoords.offset,
            )
            glyphTexCoordUpdates.push({
              offset: currentSlice.glyphTexCoords.offset,
              data: rowGeometry.glyphTexCoords,
            })
          }
          if (rowGeometry.glyphColors.length > 0) {
            geometryBuffers.glyphColors.data.set(
              rowGeometry.glyphColors,
              currentSlice.glyphColors.offset,
            )
            glyphColorUpdates.push({
              offset: currentSlice.glyphColors.offset,
              data: rowGeometry.glyphColors,
            })
          }

          currentSlice.backgroundVertexCount = rowGeometry.backgroundVertexCount
          currentSlice.glyphVertexCount = rowGeometry.glyphVertexCount
          currentSlice.glyphCount = rowGeometry.glyphCount
          currentSlice.version = nextSliceVersion()
          rowGeometries[row] = rowGeometry
          totalsNeedRecompute = true
        } else {
          const allocatedSlice = allocateRowSlice(rowGeometry)
          rowSlices[row] = allocatedSlice
          rowGeometries[row] = rowGeometry

          if (rowGeometry.backgroundPositions.length > 0) {
            backgroundPositionUpdates.push({
              offset: allocatedSlice.backgroundPositions.offset,
              data: rowGeometry.backgroundPositions,
            })
          }
          if (rowGeometry.backgroundColors.length > 0) {
            backgroundColorUpdates.push({
              offset: allocatedSlice.backgroundColors.offset,
              data: rowGeometry.backgroundColors,
            })
          }
          if (rowGeometry.glyphPositions.length > 0) {
            glyphPositionUpdates.push({
              offset: allocatedSlice.glyphPositions.offset,
              data: rowGeometry.glyphPositions,
            })
          }
          if (rowGeometry.glyphTexCoords.length > 0) {
            glyphTexCoordUpdates.push({
              offset: allocatedSlice.glyphTexCoords.offset,
              data: rowGeometry.glyphTexCoords,
            })
          }
          if (rowGeometry.glyphColors.length > 0) {
            glyphColorUpdates.push({
              offset: allocatedSlice.glyphColors.offset,
              data: rowGeometry.glyphColors,
            })
          }
        }
      }

      if (fallbackToFull) {
        const rebuildResult = performFullRebuild(
          geometryContext,
          selectionByRow,
          selectionTheme,
          toClipX,
          toClipY,
        )
        geometry = rebuildResult.geometry
        backgroundPositionsView = rebuildResult.backgroundPositionsView
        backgroundColorsView = rebuildResult.backgroundColorsView
        glyphPositionsView = rebuildResult.glyphPositionsView
        glyphTexCoordsView = rebuildResult.glyphTexCoordsView
        glyphColorsView = rebuildResult.glyphColorsView
        fullRebuildPerformed = true
        totalsNeedRecompute = false
      } else {
        if (totalsNeedRecompute) {
          recomputeTotals()
          totalsNeedRecompute = false
        }
        geometry = {
          backgroundVertexCount: totalBackgroundVertexCount,
          glyphVertexCount: totalGlyphVertexCount,
          glyphCount: totalGlyphCount,
        }
      }
    }

    if (!fullRebuildPerformed && totalsNeedRecompute) {
      recomputeTotals()
      totalsNeedRecompute = false
      geometry = {
        backgroundVertexCount: totalBackgroundVertexCount,
        glyphVertexCount: totalGlyphVertexCount,
        glyphCount: totalGlyphCount,
      }
    }

    const glyphCanvas = glyphAtlas.getCanvas()
    const glyphDirty = glyphAtlas.consumeDirtyFlag()
    uploadGlyphTexture(glyphCanvas, glyphDirty)

    gl.viewport(0, 0, canvas.width, canvas.height)

    const [clearR, clearG, clearB, clearA] = colorCache.get(fallbackBackground)
    gl.clearColor(clearR, clearG, clearB, clearA)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    let drawCalls = 0
    const start = now()
    const totalCells = snapshot.rows * snapshot.columns
    const rebuiltRowCount = fullRebuildPerformed
      ? snapshot.rows
      : rowsToRebuild.size
    const cellsProcessed =
      totalCells > 0
        ? Math.min(totalCells, rebuiltRowCount * snapshot.columns)
        : 0
    const dirtyRegionCoverage =
      totalCells > 0
        ? fullRebuildPerformed
          ? 1
          : cellsProcessed / totalCells
        : null
    let bytesUploaded = 0
    let overlayBytesUploaded: number | null = null

    if (geometry.backgroundVertexCount > 0) {
      gl.useProgram(backgroundProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, backgroundPositionBuffer)
      if (fullRebuildPerformed || !buffersInitialized) {
        ensureArrayBufferCapacity(
          gl,
          gl.ARRAY_BUFFER,
          backgroundPositionBufferState,
          geometryBuffers.backgroundPositions.capacityBytes,
        )
        if (backgroundPositionsView.length > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, backgroundPositionsView)
          bytesUploaded += backgroundPositionsView.byteLength
        }
      } else {
        for (const update of backgroundPositionUpdates) {
          if (update.data.length === 0) {
            continue
          }
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            update.offset * Float32Array.BYTES_PER_ELEMENT,
            update.data,
          )
          bytesUploaded += update.data.byteLength
        }
      }
      gl.enableVertexAttribArray(backgroundPositionLocation)
      gl.vertexAttribPointer(
        backgroundPositionLocation,
        2,
        gl.FLOAT,
        false,
        0,
        0,
      )

      gl.bindBuffer(gl.ARRAY_BUFFER, backgroundColorBuffer)
      if (fullRebuildPerformed || !buffersInitialized) {
        ensureArrayBufferCapacity(
          gl,
          gl.ARRAY_BUFFER,
          backgroundColorBufferState,
          geometryBuffers.backgroundColors.capacityBytes,
        )
        if (backgroundColorsView.length > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, backgroundColorsView)
          bytesUploaded += backgroundColorsView.byteLength
        }
      } else {
        for (const update of backgroundColorUpdates) {
          if (update.data.length === 0) {
            continue
          }
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            update.offset * Float32Array.BYTES_PER_ELEMENT,
            update.data,
          )
          bytesUploaded += update.data.byteLength
        }
      }
      gl.enableVertexAttribArray(backgroundColorLocation)
      gl.vertexAttribPointer(backgroundColorLocation, 4, gl.FLOAT, false, 0, 0)

      gl.drawArrays(gl.TRIANGLES, 0, geometry.backgroundVertexCount)
      drawCalls += 1
    }

    if (geometry.glyphVertexCount > 0) {
      gl.useProgram(glyphProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, glyphPositionBuffer)
      if (fullRebuildPerformed || !buffersInitialized) {
        ensureArrayBufferCapacity(
          gl,
          gl.ARRAY_BUFFER,
          glyphPositionBufferState,
          geometryBuffers.glyphPositions.capacityBytes,
        )
        if (glyphPositionsView.length > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, glyphPositionsView)
          bytesUploaded += glyphPositionsView.byteLength
        }
      } else {
        for (const update of glyphPositionUpdates) {
          if (update.data.length === 0) {
            continue
          }
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            update.offset * Float32Array.BYTES_PER_ELEMENT,
            update.data,
          )
          bytesUploaded += update.data.byteLength
        }
      }
      gl.enableVertexAttribArray(glyphPositionLocation)
      gl.vertexAttribPointer(glyphPositionLocation, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, glyphTexCoordBuffer)
      if (fullRebuildPerformed || !buffersInitialized) {
        ensureArrayBufferCapacity(
          gl,
          gl.ARRAY_BUFFER,
          glyphTexCoordBufferState,
          geometryBuffers.glyphTexCoords.capacityBytes,
        )
        if (glyphTexCoordsView.length > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, glyphTexCoordsView)
          bytesUploaded += glyphTexCoordsView.byteLength
        }
      } else {
        for (const update of glyphTexCoordUpdates) {
          if (update.data.length === 0) {
            continue
          }
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            update.offset * Float32Array.BYTES_PER_ELEMENT,
            update.data,
          )
          bytesUploaded += update.data.byteLength
        }
      }
      gl.enableVertexAttribArray(glyphTexCoordLocation)
      gl.vertexAttribPointer(glyphTexCoordLocation, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, glyphColorBuffer)
      if (fullRebuildPerformed || !buffersInitialized) {
        ensureArrayBufferCapacity(
          gl,
          gl.ARRAY_BUFFER,
          glyphColorBufferState,
          geometryBuffers.glyphColors.capacityBytes,
        )
        if (glyphColorsView.length > 0) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, glyphColorsView)
          bytesUploaded += glyphColorsView.byteLength
        }
      } else {
        for (const update of glyphColorUpdates) {
          if (update.data.length === 0) {
            continue
          }
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            update.offset * Float32Array.BYTES_PER_ELEMENT,
            update.data,
          )
          bytesUploaded += update.data.byteLength
        }
      }
      gl.enableVertexAttribArray(glyphColorLocation)
      gl.vertexAttribPointer(glyphColorLocation, 4, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, glyphTexture)
      gl.uniform1i(glyphTextureLocation, 0)

      gl.drawArrays(gl.TRIANGLES, 0, geometry.glyphVertexCount)
      drawCalls += 1
    }

    buffersInitialized = true

    if (
      customCursorOverlay &&
      overlayCanvas &&
      overlayCtx &&
      uploadOverlayTexture &&
      overlayProgram &&
      overlayTexture &&
      overlayPositionBuffer &&
      overlayTexCoordBuffer &&
      overlayTextureLocation !== null
    ) {
      ensureOverlaySize(
        overlayCanvas,
        layout.logicalWidth,
        layout.logicalHeight,
      )
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
      customCursorOverlay({
        ctx: overlayCtx,
        snapshot,
        metrics,
        theme,
        selection: snapshot.selection ?? null,
      })
      uploadOverlayTexture(overlayCanvas, true)
      overlayBytesUploaded = overlayCanvas.width * overlayCanvas.height * 4
      bytesUploaded += overlayBytesUploaded

      gl.useProgram(overlayProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, overlayPositionBuffer)
      gl.enableVertexAttribArray(overlayPositionLocation)
      gl.vertexAttribPointer(overlayPositionLocation, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, overlayTexCoordBuffer)
      gl.enableVertexAttribArray(overlayTexCoordLocation)
      gl.vertexAttribPointer(overlayTexCoordLocation, 2, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, overlayTexture)
      gl.uniform1i(overlayTextureLocation, 0)

      gl.drawArrays(gl.TRIANGLES, 0, OVERLAY_POSITIONS.length / 2)
      drawCalls += 1
    }

    const duration = now() - start
    diagnostics = updateDiagnostics(diagnostics, {
      frameDuration: duration,
      drawCalls,
      cellsProcessed,
      bytesUploaded,
      dirtyRegionCoverage,
      overlayBytesUploaded,
    })
  }

  const renderer: CanvasRenderer = {
    canvas,
    applyUpdates({ snapshot, updates }) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      const previousSnapshot = currentSnapshot
      currentSnapshot = snapshot

      let requiresRepaint = false
      let selectionChanged = false
      let trackedCursor = previousSnapshot.cursor
      let trackedSelection = currentSelection

      for (const update of updates) {
        switch (update.type) {
          case 'cells':
            for (const cell of update.cells) {
              dirtyTracker.markCell(cell.row, cell.column)
            }
            requiresRepaint = true
            break
          case 'clear':
            switch (update.scope) {
              case 'display':
              case 'display-after-cursor':
                dirtyTracker.markFull()
                break
              case 'line':
                dirtyTracker.markRow(snapshot.cursor.row)
                break
              case 'line-after-cursor':
                dirtyTracker.markRange(
                  snapshot.cursor.row,
                  snapshot.cursor.column,
                  Number.POSITIVE_INFINITY,
                )
                break
              default:
                dirtyTracker.markFull()
                break
            }
            requiresRepaint = true
            break
          case 'cursor':
            dirtyTracker.markCell(trackedCursor.row, trackedCursor.column)
            trackedCursor = update.position
            dirtyTracker.markCell(trackedCursor.row, trackedCursor.column)
            requiresRepaint = true
            break
          case 'scroll':
            if (
              !handleScrollUpdate(
                update.amount,
                previousSnapshot,
                snapshot,
              )
            ) {
              dirtyTracker.markFull()
            }
            requiresRepaint = true
            break
          case 'bell':
            break
          case 'attributes':
            dirtyTracker.markFull()
            requiresRepaint = true
            break
          case 'scroll-region':
            dirtyTracker.markFull()
            requiresRepaint = true
            break
          case 'mode':
            dirtyTracker.markFull()
            requiresRepaint = true
            break
          case 'cursor-visibility':
            dirtyTracker.markCell(trackedCursor.row, trackedCursor.column)
            requiresRepaint = true
            break
          case 'response':
            break
          case 'palette': {
            const nextColor = resolvePaletteOverrideColor(
              update.color,
              theme,
              paletteOverrides,
              update.index,
            )
            if (nextColor === null) {
              paletteOverrides.delete(update.index)
            } else {
              paletteOverrides.set(update.index, nextColor)
            }
            dirtyTracker.markFull()
            requiresRepaint = true
            break
          }
          case 'osc':
            diagnostics = {
              ...diagnostics,
              lastOsc: {
                identifier: update.identifier,
                data: update.data,
              },
            }
            break
          case 'sos-pm-apc':
            diagnostics = {
              ...diagnostics,
              lastSosPmApc: {
                kind: update.kind,
                data: update.data,
              },
            }
            break
          case 'dcs-start':
            pendingDcs = {
              finalByte: update.finalByte,
              params: [...update.params],
              intermediates: [...update.intermediates],
              data: '',
            }
            break
          case 'dcs-data':
            if (pendingDcs) {
              pendingDcs = {
                ...pendingDcs,
                data: pendingDcs.data + update.data,
              }
            }
            break
          case 'dcs-end': {
            const accumulated = pendingDcs?.data ?? ''
            diagnostics = {
              ...diagnostics,
              lastDcs: {
                finalByte: update.finalByte,
                params: [...update.params],
                intermediates: [...update.intermediates],
                data: accumulated + update.data,
              },
            }
            pendingDcs = null
            break
          }
          case 'selection-set':
          case 'selection-update':
            dirtyTracker.markSelection(
              trackedSelection,
              snapshot.columns,
            )
            trackedSelection = update.selection
            dirtyTracker.markSelection(trackedSelection, snapshot.columns)
            currentSelection = update.selection
            selectionChanged = true
            requiresRepaint = true
            break
          case 'selection-clear':
            if (currentSelection !== null) {
              dirtyTracker.markSelection(
                trackedSelection,
                snapshot.columns,
              )
              trackedSelection = null
              currentSelection = null
              selectionChanged = true
              requiresRepaint = true
            }
            break
          case 'clipboard':
          case 'title':
          case 'c1-transmission':
            break
          default:
            dirtyTracker.markFull()
            requiresRepaint = true
            break
        }
      }

      if (requiresRepaint) {
        renderSnapshot(currentSnapshot)
      }

      if (selectionChanged) {
        consumeSelectionChange(currentSelection)
      }
    },
    resize({ snapshot, metrics: nextMetrics }) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      metrics = nextMetrics
      glyphAtlas.reset(nextMetrics)
      colorCache.clear()
      currentSnapshot = snapshot
      currentSelection = snapshot.selection ?? null
      dirtyTracker.markFull()
      renderSnapshot(currentSnapshot)
      consumeSelectionChange(currentSelection)
    },
    setTheme(nextTheme) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      theme = nextTheme
      colorCache.clear()
      dirtyTracker.markFull()
      renderSnapshot(currentSnapshot)
    },
    sync(snapshot) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      currentSnapshot = snapshot
      currentSelection = snapshot.selection ?? null
      dirtyTracker.markFull()
      renderSnapshot(snapshot)
      consumeSelectionChange(currentSelection)
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      gl.deleteTexture(glyphTexture)
      if (overlayTexture) {
        gl.deleteTexture(overlayTexture)
      }
      gl.deleteBuffer(backgroundPositionBuffer)
      gl.deleteBuffer(backgroundColorBuffer)
      gl.deleteBuffer(glyphPositionBuffer)
      gl.deleteBuffer(glyphTexCoordBuffer)
      gl.deleteBuffer(glyphColorBuffer)
      if (overlayPositionBuffer) {
        gl.deleteBuffer(overlayPositionBuffer)
      }
      if (overlayTexCoordBuffer) {
        gl.deleteBuffer(overlayTexCoordBuffer)
      }
      gl.deleteProgram(backgroundProgram)
      gl.deleteProgram(glyphProgram)
      if (overlayProgram) {
        gl.deleteProgram(overlayProgram)
      }
    },
    get diagnostics() {
      return diagnostics
    },
    get currentSelection() {
      return currentSelection
    },
    set onSelectionChange(listener) {
      selectionListener = listener
      listener?.(currentSelection)
    },
    get onSelectionChange() {
      return selectionListener
    },
  }

  renderSnapshot(currentSnapshot)
  consumeSelectionChange(currentSelection)

  return renderer
}

export const tryCreateWebglCanvasRenderer = (
  options: CanvasRendererOptions,
  config: WebglBackendConfig,
  existingSupport?: WebglSupportResult,
): WebglInitOutcome => {
  const support = existingSupport
    ? existingSupport
    : detectWebglSupport({
        canvas: options.canvas,
        contextAttributes: config.contextAttributes,
      })

  if (!support.supported || !support.contextKind) {
    return {
      success: false,
      reason: support.reason ?? 'WebGL context not available',
      support,
    }
  }

  const attempt = (kind: 'webgl2' | 'webgl'): WebglInitOutcome => {
    const gl = createWebglContext(
      options.canvas,
      kind,
      config.contextAttributes,
    )
    if (!gl) {
      return {
        success: false,
        reason: 'Failed to acquire WebGL context',
        support: { ...support, contextKind: kind },
      }
    }

    if (kind === 'webgl') {
      const missingExtensions = checkWebgl1Extensions(
        gl as WebGLRenderingContext,
      )
      if (missingExtensions.length > 0) {
        releaseContext(gl)
        return {
          success: false,
          reason: `Missing required extensions: ${missingExtensions.join(', ')}`,
          support: { ...support, contextKind: 'webgl', missingExtensions },
        }
      }
    }

    try {
      const renderer = createWebglRenderer(gl, options, {
        ...support,
        contextKind: kind,
      })
      return {
        success: true,
        renderer,
        support: { ...support, contextKind: kind },
      }
    } catch (error) {
      releaseContext(gl)
      return {
        success: false,
        reason:
          error instanceof Error
            ? error.message
            : 'Unknown WebGL initialisation error',
        support: { ...support, contextKind: kind },
      }
    }
  }

  if (support.contextKind === 'webgl2') {
    const webgl2Result = attempt('webgl2')
    if (webgl2Result.success) {
      return webgl2Result
    }
    const webgl1Result = attempt('webgl')
    if (webgl1Result.success) {
      return webgl1Result
    }
    return webgl2Result
  }

  return attempt('webgl')
}

export const createWebglBackendProvider = (): RendererBackendProvider<
  WebglBackendConfig,
  WebglSupportResult
> => ({
  kind: 'gpu-webgl',
  matches: (config): config is WebglBackendConfig =>
    config.type === 'gpu-webgl',
  normalizeConfig: (config) => ({
    type: 'gpu-webgl',
    contextAttributes: config?.contextAttributes,
    fallback: config?.fallback ?? 'prefer-gpu',
  }),
  probe: (context, config) =>
    detectWebglSupport({
      canvas: context.canvas,
      contextAttributes:
        context.webgl?.contextAttributes ?? config.contextAttributes,
    }),
  create: (options, config, support) => {
    if (!support.supported) {
      throw new Error(support.reason ?? 'WebGL renderer not supported')
    }
    const outcome = tryCreateWebglCanvasRenderer(options, config, support)
    if (!outcome.success) {
      throw new Error(outcome.reason ?? 'WebGL renderer initialisation failed')
    }
    return outcome.renderer
  },
})
