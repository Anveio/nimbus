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
  readonly backgroundPositions: Float32Array
  readonly backgroundColors: Float32Array
  readonly backgroundVertexCount: number
  readonly glyphPositions: Float32Array
  readonly glyphTexCoords: Float32Array
  readonly glyphColors: Float32Array
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

const buildFrameGeometry = ({
  snapshot,
  metrics,
  theme,
  paletteOverrides,
  glyphAtlas,
  colorCache,
  fallbackForeground,
  fallbackBackground,
  includeCursor,
}: BuildGeometryParams): FrameGeometry => {
  const cellWidth = metrics.cell.width
  const cellHeight = metrics.cell.height
  const logicalWidth = Math.max(1, snapshot.columns * cellWidth)
  const logicalHeight = Math.max(1, snapshot.rows * cellHeight)

  const toClipX = (value: number): number => (value / logicalWidth) * 2 - 1
  const toClipY = (value: number): number => 1 - (value / logicalHeight) * 2

  const backgroundPositions: number[] = []
  const backgroundColors: number[] = []
  const glyphPositions: number[] = []
  const glyphTexCoords: number[] = []
  const glyphColors: number[] = []

  let backgroundVertexCount = 0
  let glyphVertexCount = 0
  let glyphCount = 0

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

    backgroundPositions.push(x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2)

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

    glyphPositions.push(x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2)

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

  const selection = snapshot.selection ?? null
  const selectionTheme = theme.selection
  const selectionSegments = selection
    ? getSelectionRowSegments(selection, snapshot.columns)
    : []
  const selectionByRow = new Map<number, SelectionRowSegment>()
  for (const segment of selectionSegments) {
    selectionByRow.set(segment.row, segment)
    if (selectionTheme?.background) {
      const highlightX = segment.startColumn * cellWidth
      const highlightWidth =
        (segment.endColumn - segment.startColumn + 1) * cellWidth
      pushBackgroundQuad(
        highlightX,
        segment.row * cellHeight,
        highlightWidth,
        cellHeight,
        selectionTheme.background,
      )
    }
  }

  for (let row = 0; row < snapshot.rows; row += 1) {
    const bufferRow = snapshot.buffer[row]
    const selectionSegment = selectionByRow.get(row) ?? null

    for (let column = 0; column < snapshot.columns; column += 1) {
      const cell = bufferRow?.[column] ?? DEFAULT_CELL
      const x = column * cellWidth
      const y = row * cellHeight

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
        pushBackgroundQuad(x, y, cellWidth, cellHeight, effectiveBackground)
      }

      if (effectiveForeground) {
        if (cell.attr.underline !== 'none') {
          const thickness = Math.max(1, Math.round(cellHeight * 0.08))
          const baseY = y + cellHeight - thickness
          pushBackgroundQuad(
            x,
            baseY,
            cellWidth,
            thickness,
            effectiveForeground,
          )
          if (cell.attr.underline === 'double') {
            const gap = thickness + 2
            const secondY = Math.max(y, baseY - gap)
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
          const strikeY =
            y + Math.round(cellHeight / 2) - Math.floor(thickness / 2)
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
        pushGlyphQuad(x, y, glyph, effectiveForeground, alphaMultiplier)
      }
    }
  }

  if (includeCursor && snapshot.cursorVisible) {
    const cursor = snapshot.cursor
    const cursorTheme = theme.cursor
    const cursorShape = cursorTheme.shape ?? 'block'
    const cursorOpacity = cursorTheme.opacity ?? 1
    const cursorColor = cursorTheme.color
    const x = cursor.column * cellWidth
    const y = cursor.row * cellHeight

    switch (cursorShape) {
      case 'underline': {
        const height = Math.max(1, Math.round(cellHeight * 0.2))
        pushBackgroundQuad(
          x,
          y + cellHeight - height,
          cellWidth,
          height,
          cursorColor,
          cursorOpacity,
        )
        break
      }
      case 'bar': {
        const width = Math.max(1, Math.round(cellWidth * 0.2))
        pushBackgroundQuad(x, y, width, cellHeight, cursorColor, cursorOpacity)
        break
      }
      case 'block':
      default: {
        pushBackgroundQuad(
          x,
          y,
          cellWidth,
          cellHeight,
          cursorColor,
          cursorOpacity,
        )
        break
      }
    }
  }

  return {
    backgroundPositions: new Float32Array(backgroundPositions),
    backgroundColors: new Float32Array(backgroundColors),
    backgroundVertexCount,
    glyphPositions: new Float32Array(glyphPositions),
    glyphTexCoords: new Float32Array(glyphTexCoords),
    glyphColors: new Float32Array(glyphColors),
    glyphVertexCount,
    glyphCount,
  }
}

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

const updateDiagnostics = (
  diagnostics: CanvasRendererDiagnostics,
  frameDuration: number,
  drawCalls: number,
): CanvasRendererDiagnostics => ({
  ...diagnostics,
  lastFrameDurationMs: frameDuration,
  lastDrawCallCount: drawCalls,
  gpuFrameDurationMs: frameDuration,
  gpuDrawCallCount: drawCalls,
})

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

  const glyphTexture = createTexture(gl)
  const uploadGlyphTexture = createTextureUploader(gl, glyphTexture)

  const overlayTexture = overlayProgram ? createTexture(gl) : null
  const uploadOverlayTexture = overlayTexture
    ? createTextureUploader(gl, overlayTexture)
    : null

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

    const geometry = buildFrameGeometry({
      snapshot,
      metrics,
      theme,
      paletteOverrides,
      glyphAtlas,
      colorCache,
      fallbackForeground,
      fallbackBackground,
      includeCursor: !customCursorOverlay,
    })

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

    if (geometry.backgroundVertexCount > 0) {
      gl.useProgram(backgroundProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, backgroundPositionBuffer)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        geometry.backgroundPositions,
        gl.DYNAMIC_DRAW,
      )
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
      gl.bufferData(gl.ARRAY_BUFFER, geometry.backgroundColors, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(backgroundColorLocation)
      gl.vertexAttribPointer(backgroundColorLocation, 4, gl.FLOAT, false, 0, 0)

      gl.drawArrays(gl.TRIANGLES, 0, geometry.backgroundVertexCount)
      drawCalls += 1
    }

    if (geometry.glyphVertexCount > 0) {
      gl.useProgram(glyphProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, glyphPositionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, geometry.glyphPositions, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(glyphPositionLocation)
      gl.vertexAttribPointer(glyphPositionLocation, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, glyphTexCoordBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, geometry.glyphTexCoords, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(glyphTexCoordLocation)
      gl.vertexAttribPointer(glyphTexCoordLocation, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, glyphColorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, geometry.glyphColors, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(glyphColorLocation)
      gl.vertexAttribPointer(glyphColorLocation, 4, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, glyphTexture)
      gl.uniform1i(glyphTextureLocation, 0)

      gl.drawArrays(gl.TRIANGLES, 0, geometry.glyphVertexCount)
      drawCalls += 1
    }

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
    diagnostics = updateDiagnostics(diagnostics, duration, drawCalls)
  }

  const renderer: CanvasRenderer = {
    canvas,
    applyUpdates({ snapshot, updates }) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      currentSnapshot = snapshot

      let requiresRepaint = false
      let selectionChanged = false

      for (const update of updates) {
        switch (update.type) {
          case 'cells':
          case 'clear':
          case 'cursor':
          case 'scroll':
          case 'attributes':
          case 'scroll-region':
          case 'mode':
          case 'cursor-visibility':
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
            currentSelection = update.selection
            selectionChanged = true
            requiresRepaint = true
            break
          case 'selection-clear':
            if (currentSelection !== null) {
              currentSelection = null
              selectionChanged = true
              requiresRepaint = true
            }
            break
          default:
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
      renderSnapshot(currentSnapshot)
      consumeSelectionChange(currentSelection)
    },
    setTheme(nextTheme) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      theme = nextTheme
      colorCache.clear()
      renderSnapshot(currentSnapshot)
    },
    sync(snapshot) {
      if (disposed) {
        throw new Error('CanvasRenderer instance has been disposed')
      }
      currentSnapshot = snapshot
      currentSelection = snapshot.selection ?? null
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
