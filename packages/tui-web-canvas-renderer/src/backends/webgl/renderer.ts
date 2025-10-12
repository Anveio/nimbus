import {
  getSelectionRowSegments,
  type SelectionRowSegment,
  type TerminalCell,
  type TerminalSelection,
  type TerminalState,
  type TerminalUpdate,
} from '@nimbus/vt'
import type {
  CanvasRenderer,
  CanvasRendererDiagnostics,
  CanvasRendererOptions,
  CanvasRendererUpdateOptions,
  CursorOverlayStrategy,
  RendererMetrics,
  RendererTheme,
  WebglBackendConfig,
} from '../../types'
import {
  rendererColorToRgba,
  resolveCellColorBytes,
  resolvePaletteOverrideColor,
} from '../../util/colors'
import { hashFrameBytes } from '../../util/frame-hash'
import {
  ensureCanvasDimensions,
  setCanvasStyleSize,
} from '../canvas/internal/layout'
import { BackgroundTexture } from './internal/background-texture'
import { TILE_HEIGHT_CELLS, TILE_WIDTH_CELLS } from './internal/constants'
import { DamageTracker } from './internal/damage-tracker'
import {
  bindFramebufferTexture,
  createFramebufferTexture,
  createProgram,
  disposeBuffer,
  disposeFramebuffer,
  disposeProgram,
  disposeTexture,
  disposeVertexArray,
} from './internal/gl-utils'
import { GlyphAtlas } from './internal/glyph-atlas'
import { computeGlyphRenderMetadata } from './internal/glyph-metadata'
import type { TileDefinition } from './renderer-types'

const INSTANCE_FLOAT_COUNT = 9
const INSTANCE_COLOR_OFFSET_BYTES = INSTANCE_FLOAT_COUNT * 4
const INSTANCE_STRIDE_BYTES = INSTANCE_COLOR_OFFSET_BYTES + 4
const VERTICES_PER_GLYPH = 6

interface TileResources {
  definition: TileDefinition
  vao: WebGLVertexArrayObject | null
  buffer: WebGLBuffer | null
  arrayBuffer: ArrayBuffer
  floatView: Float32Array
  byteView: Uint8Array
  scissor: { x: number; y: number; width: number; height: number }
  instanceCapacity: number
  instanceCount: number
}

interface RenderContext {
  readonly fallbackForegroundColor: string
  readonly fallbackBackgroundColor: string
  readonly fallbackForeground: [number, number, number, number]
  readonly selectionForeground: [number, number, number, number] | null
  readonly selectionSegments: Map<number, SelectionRowSegment> | null
}

interface ShaderSources {
  readonly vertex: string
  readonly fragment: string
}

const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])

const TILE_VERTEX_SHADER: ShaderSources = {
  vertex: `#version 300 es
layout(location = 0) in vec2 aCellOrigin;
layout(location = 1) in vec2 aQuadSize;
layout(location = 2) in vec2 aUv0;
layout(location = 3) in vec2 aUv1;
layout(location = 4) in vec4 aColor;
layout(location = 5) in float aFlags;

uniform vec2 uViewportPx;

out vec2 vUv;
out vec4 vColor;
out float vFlags;

vec2 quadPosition(int vertexId) {
  switch (vertexId) {
    case 0: return vec2(0.0, 0.0);
    case 1: return vec2(1.0, 0.0);
    case 2: return vec2(0.0, 1.0);
    case 3: return vec2(0.0, 1.0);
    case 4: return vec2(1.0, 0.0);
    default: return vec2(1.0, 1.0);
  }
}

void main() {
  vec2 unit = quadPosition(gl_VertexID);
  vec2 posPx = aCellOrigin + unit * aQuadSize;
  vec2 ndc;
  ndc.x = (posPx.x / uViewportPx.x) * 2.0 - 1.0;
  ndc.y = 1.0 - (posPx.y / uViewportPx.y) * 2.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUv = mix(aUv0, aUv1, unit);
  vColor = aColor;
  vFlags = aFlags;
}
`,
  fragment: `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;

in vec2 vUv;
in vec4 vColor;
in float vFlags;

out vec4 outColor;

void main() {
  vec4 glyph = texture(uAtlas, vUv);
  if (glyph.a <= 0.0) {
    discard;
  }
  if (vFlags > 0.5) {
    outColor = glyph;
  } else {
    float alpha = glyph.a * vColor.a;
    vec3 tinted = vColor.rgb * alpha;
    outColor = vec4(tinted, alpha);
  }
}
`,
}
const BACKGROUND_SHADER: ShaderSources = {
  vertex: `#version 300 es
layout(location = 0) in vec2 aPosition;

out vec2 vUv;

void main() {
  vUv = (aPosition * 0.5) + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,
  fragment: `#version 300 es
precision mediump float;

uniform sampler2D uBackground;
uniform ivec2 uTextureSize;

in vec2 vUv;

out vec4 outColor;

void main() {
  ivec2 texCoord = ivec2(vUv * vec2(uTextureSize));
  texCoord = clamp(texCoord, ivec2(0), uTextureSize - ivec2(1));
  outColor = texelFetch(uBackground, texCoord, 0);
}
`,
}

const PRESENT_SHADER: ShaderSources = {
  vertex: BACKGROUND_SHADER.vertex,
  fragment: `#version 300 es
precision mediump float;

uniform sampler2D uContent;

in vec2 vUv;

out vec4 outColor;

void main() {
  outColor = texture(uContent, vUv);
}
`,
}
const SCROLL_SHADER: ShaderSources = {
  vertex: BACKGROUND_SHADER.vertex,
  fragment: `#version 300 es
precision mediump float;

uniform sampler2D uSource;
uniform float uOffset;

in vec2 vUv;

out vec4 outColor;

void main() {
  vec2 uv = vec2(vUv.x, vUv.y - uOffset);
  uv = clamp(uv, vec2(0.0), vec2(1.0));
  outColor = texture(uSource, uv);
}
`,
}

const createProgramPair = (
  gl: WebGL2RenderingContext,
  sources: ShaderSources,
): WebGLProgram => createProgram(gl, sources.vertex, sources.fragment)

const updateBackendAttribute = (canvas: unknown, backend: string): void => {
  if (typeof (canvas as HTMLCanvasElement).dataset !== 'undefined') {
    const element = canvas as HTMLCanvasElement
    element.dataset.nimbusRendererBackend = backend
    element.dataset.manaRendererBackend = backend
  }
}

const createOverlayContext = (): CanvasRenderingContext2D | null => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1)
    return canvas.getContext('2d') as CanvasRenderingContext2D | null
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return canvas.getContext('2d')
  }
  return null
}

export class WebglCanvasRenderer implements CanvasRenderer {
  readonly canvas: CanvasRendererOptions['canvas']
  private readonly gl: WebGL2RenderingContext
  private readonly config: WebglBackendConfig
  private metrics: RendererMetrics
  private theme: RendererTheme
  private snapshot: TerminalState
  private readonly cursorOverlayStrategy?: CursorOverlayStrategy
  private overlayContext: CanvasRenderingContext2D | null
  onSelectionChange?: (selection: TerminalSelection | null) => void

  private _currentSelection: TerminalSelection | null
  private lastCursorPosition: { row: number; column: number }
  private readonly glyphAtlas: GlyphAtlas
  private readonly backgroundTexture: BackgroundTexture
  private readonly tileResources: TileResources[] = []
  private readonly paletteOverrides = new Map<number, string>()
  private readonly damageTracker = new DamageTracker()
  private readonly captureDiagnosticsFrame: boolean
  private columns = 0
  private rows = 0
  private tileColumns = 0
  private tileRows = 0
  private scaledWidth = 0
  private scaledHeight = 0
  private cellWidthPx = 0
  private cellHeightPx = 0

  private backgroundProgram: WebGLProgram
  private tileProgram: WebGLProgram
  private presentProgram: WebGLProgram
  private scrollProgram: WebGLProgram
  private quadVao: WebGLVertexArrayObject | null
  private quadVbo: WebGLBuffer | null

  private framebuffer: WebGLFramebuffer | null
  private readonly contentTextures: [WebGLTexture | null, WebGLTexture | null]
  private activeTextureIndex = 0

  private readonly uniforms: {
    tile: {
      atlas: WebGLUniformLocation | null
      viewportPx: WebGLUniformLocation | null
    }
    background: {
      sampler: WebGLUniformLocation | null
      textureSize: WebGLUniformLocation | null
    }
    present: {
      sampler: WebGLUniformLocation | null
    }
    scroll: {
      sampler: WebGLUniformLocation | null
      offset: WebGLUniformLocation | null
    }
  }

  private diagnosticsState: CanvasRendererDiagnostics

  constructor(
    options: CanvasRendererOptions,
    gl: WebGL2RenderingContext,
    config: WebglBackendConfig,
  ) {
    this.canvas = options.canvas
    this.gl = gl
    this.config = config
    this.metrics = options.metrics
    this.theme = options.theme
    this.snapshot = options.snapshot
    this.cursorOverlayStrategy = options.cursorOverlayStrategy
    this.overlayContext = this.cursorOverlayStrategy
      ? createOverlayContext()
      : null
    this._currentSelection = options.snapshot.selection ?? null
    this.lastCursorPosition = { ...options.snapshot.cursor }
    this.onSelectionChange = options.onSelectionChange

    updateBackendAttribute(this.canvas, 'gpu-webgl')

    this.backgroundProgram = createProgramPair(this.gl, BACKGROUND_SHADER)
    this.tileProgram = createProgramPair(this.gl, TILE_VERTEX_SHADER)
    this.presentProgram = createProgramPair(this.gl, PRESENT_SHADER)
    this.scrollProgram = createProgramPair(this.gl, SCROLL_SHADER)

    this.uniforms = {
      tile: {
        atlas: this.gl.getUniformLocation(this.tileProgram, 'uAtlas'),
        viewportPx: this.gl.getUniformLocation(this.tileProgram, 'uViewportPx'),
      },
      background: {
        sampler: this.gl.getUniformLocation(
          this.backgroundProgram,
          'uBackground',
        ),
        textureSize: this.gl.getUniformLocation(
          this.backgroundProgram,
          'uTextureSize',
        ),
      },
      present: {
        sampler: this.gl.getUniformLocation(this.presentProgram, 'uContent'),
      },
      scroll: {
        sampler: this.gl.getUniformLocation(this.scrollProgram, 'uSource'),
        offset: this.gl.getUniformLocation(this.scrollProgram, 'uOffset'),
      },
    }

    this.quadVao = this.gl.createVertexArray()
    this.quadVbo = this.gl.createBuffer()
    this.gl.bindVertexArray(this.quadVao)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVbo)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW)
    this.gl.enableVertexAttribArray(0)
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0)
    this.gl.bindVertexArray(null)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)

    this.framebuffer = this.gl.createFramebuffer()
    this.contentTextures = [null, null]

    this.glyphAtlas = new GlyphAtlas(this.gl, this.metrics)
    this.backgroundTexture = new BackgroundTexture(this.gl, this.theme)
    this.captureDiagnosticsFrame = Boolean(options.captureDiagnosticsFrame)

    this.diagnosticsState = {
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
      frameHash: undefined,
    }

    this.configureFromSnapshot(options.snapshot)
    this.renderFullFrame()
  }

  get diagnostics(): CanvasRendererDiagnostics {
    return this.diagnosticsState
  }

  get currentSelection(): TerminalSelection | null {
    return this._currentSelection
  }

  getCurrentSelection = (): TerminalSelection | null => this._currentSelection

  applyUpdates({
    snapshot,
    updates,
    metrics,
    theme,
  }: CanvasRendererUpdateOptions): void {
    const previousSnapshot = this.snapshot
    const pendingUpdates = updates ?? []
    const metricsChanged = typeof metrics !== 'undefined'
    const themeChanged = typeof theme !== 'undefined'

    if (metricsChanged) {
      this.metrics = metrics
    }
    if (themeChanged) {
      this.theme = theme
      this.backgroundTexture.setTheme(theme)
      this.paletteOverrides.clear()
      this.backgroundTexture.clearPaletteOverrides()
    }

    this.snapshot = snapshot
    if (metricsChanged) {
      this.configureFromSnapshot(snapshot)
    }

    this.handleUpdates(pendingUpdates)
    this._currentSelection = snapshot.selection ?? null
    this.onSelectionChange?.(this._currentSelection)

    if (metricsChanged || themeChanged) {
      this.renderFullFrame()
      return
    }

    if (pendingUpdates.length === 0) {
      return
    }

    const { requireFull } = this.markDamageFromUpdates(
      pendingUpdates,
      previousSnapshot,
    )
    if (requireFull) {
      this.renderFullFrame()
    } else {
      this.renderDamagedFrame()
    }
  }

  sync(snapshot: TerminalState): void {
    this.snapshot = snapshot
    this._currentSelection = snapshot.selection ?? null
    this.onSelectionChange?.(this._currentSelection)
    this.configureFromSnapshot(snapshot)
    this.renderFullFrame()
  }

  dispose(): void {
    disposeProgram(this.gl, this.backgroundProgram)
    disposeProgram(this.gl, this.tileProgram)
    disposeProgram(this.gl, this.presentProgram)
    disposeProgram(this.gl, this.scrollProgram)
    disposeVertexArray(this.gl, this.quadVao)
    disposeBuffer(this.gl, this.quadVbo)

    disposeFramebuffer(this.gl, this.framebuffer)
    disposeTexture(this.gl, this.contentTextures[0])
    disposeTexture(this.gl, this.contentTextures[1])

    for (const tile of this.tileResources) {
      disposeVertexArray(this.gl, tile.vao)
      disposeBuffer(this.gl, tile.buffer)
    }

    this.glyphAtlas.dispose()
    this.backgroundTexture.dispose()

    const loseContext = this.gl.getExtension('WEBGL_lose_context')
    loseContext?.loseContext()
  }

  private configureFromSnapshot(snapshot: TerminalState): void {
    const layout = ensureCanvasDimensions(this.canvas, snapshot, this.metrics)
    setCanvasStyleSize(this.canvas, layout)

    this.columns = snapshot.columns
    this.rows = snapshot.rows
    this.scaledWidth = layout.scaledWidth
    this.scaledHeight = layout.scaledHeight
    this.cellWidthPx = Math.max(
      1,
      Math.round(this.metrics.cell.width * this.metrics.devicePixelRatio),
    )
    this.cellHeightPx = Math.max(
      1,
      Math.round(this.metrics.cell.height * this.metrics.devicePixelRatio),
    )

    this.glyphAtlas.setMetrics(this.metrics)
    this.allocateTiles()
    this.allocateRenderTargets()
  }

  private allocateTiles(): void {
    const tileColumns = Math.max(1, Math.ceil(this.columns / TILE_WIDTH_CELLS))
    const tileRows = Math.max(1, Math.ceil(this.rows / TILE_HEIGHT_CELLS))

    this.tileColumns = tileColumns
    this.tileRows = tileRows

    const tiles: TileDefinition[] = []
    let index = 0
    for (let ty = 0; ty < tileRows; ty += 1) {
      const row0 = ty * TILE_HEIGHT_CELLS
      const rows = Math.min(TILE_HEIGHT_CELLS, this.rows - row0)
      for (let tx = 0; tx < tileColumns; tx += 1) {
        const col0 = tx * TILE_WIDTH_CELLS
        const cols = Math.min(TILE_WIDTH_CELLS, this.columns - col0)
        tiles.push({
          index,
          col0,
          row0,
          cols,
          rows,
          instanceCount: cols * rows,
        })
        index += 1
      }
    }

    if (this.tileResources.length > tiles.length) {
      for (let i = tiles.length; i < this.tileResources.length; i += 1) {
        const resource = this.tileResources[i]
        if (resource) {
          disposeVertexArray(this.gl, resource.vao)
          disposeBuffer(this.gl, resource.buffer)
        }
      }
      this.tileResources.length = tiles.length
    }
    for (let i = 0; i < tiles.length; i += 1) {
      const definition = tiles[i]!
      const resources = this.tileResources[i]
      const instanceCount = definition.instanceCount
      const requiredBytes = instanceCount * INSTANCE_STRIDE_BYTES
      const scissor = {
        x: definition.col0 * this.cellWidthPx,
        y:
          this.scaledHeight -
          (definition.row0 + definition.rows) * this.cellHeightPx,
        width: Math.max(1, definition.cols * this.cellWidthPx),
        height: Math.max(1, definition.rows * this.cellHeightPx),
      }
      if (!resources) {
        const arrayBuffer = new ArrayBuffer(requiredBytes)
        const floatView = new Float32Array(arrayBuffer)
        const byteView = new Uint8Array(arrayBuffer)
        const vao = this.gl.createVertexArray()
        const buffer = this.gl.createBuffer()
        if (!vao || !buffer) {
          throw new Error('Unable to allocate tile buffers')
        }
        this.gl.bindVertexArray(vao)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer)
        this.gl.bufferData(
          this.gl.ARRAY_BUFFER,
          arrayBuffer,
          this.gl.DYNAMIC_DRAW,
        )

        this.gl.enableVertexAttribArray(0)
        this.gl.vertexAttribPointer(
          0,
          2,
          this.gl.FLOAT,
          false,
          INSTANCE_STRIDE_BYTES,
          0,
        )
        this.gl.vertexAttribDivisor(0, 1)

        this.gl.enableVertexAttribArray(1)
        this.gl.vertexAttribPointer(
          1,
          2,
          this.gl.FLOAT,
          false,
          INSTANCE_STRIDE_BYTES,
          2 * 4,
        )
        this.gl.vertexAttribDivisor(1, 1)

        this.gl.enableVertexAttribArray(2)
        this.gl.vertexAttribPointer(
          2,
          2,
          this.gl.FLOAT,
          false,
          INSTANCE_STRIDE_BYTES,
          4 * 4,
        )
        this.gl.vertexAttribDivisor(2, 1)

        this.gl.enableVertexAttribArray(3)
        this.gl.vertexAttribPointer(
          3,
          2,
          this.gl.FLOAT,
          false,
          INSTANCE_STRIDE_BYTES,
          6 * 4,
        )
        this.gl.vertexAttribDivisor(3, 1)

        this.gl.enableVertexAttribArray(4)
        this.gl.vertexAttribPointer(
          4,
          4,
          this.gl.UNSIGNED_BYTE,
          true,
          INSTANCE_STRIDE_BYTES,
          INSTANCE_COLOR_OFFSET_BYTES,
        )
        this.gl.vertexAttribDivisor(4, 1)

        this.gl.enableVertexAttribArray(5)
        this.gl.vertexAttribPointer(
          5,
          1,
          this.gl.FLOAT,
          false,
          INSTANCE_STRIDE_BYTES,
          (INSTANCE_FLOAT_COUNT - 1) * 4,
        )
        this.gl.vertexAttribDivisor(5, 1)

        this.gl.bindVertexArray(null)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)

        this.tileResources[i] = {
          definition,
          vao,
          buffer,
          arrayBuffer,
          floatView,
          byteView,
          scissor,
          instanceCount: definition.instanceCount,
          instanceCapacity: definition.instanceCount,
        }
        continue
      }

      if (resources.arrayBuffer.byteLength !== requiredBytes) {
        resources.arrayBuffer = new ArrayBuffer(requiredBytes)
        resources.floatView = new Float32Array(resources.arrayBuffer)
        resources.byteView = new Uint8Array(resources.arrayBuffer)
        resources.instanceCapacity = definition.instanceCount
        this.gl.bindVertexArray(resources.vao)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, resources.buffer)
        this.gl.bufferData(
          this.gl.ARRAY_BUFFER,
          resources.arrayBuffer,
          this.gl.DYNAMIC_DRAW,
        )
        this.gl.bindVertexArray(null)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)
      }
      resources.definition = definition
      resources.scissor = scissor
      resources.instanceCapacity = definition.instanceCount
      resources.instanceCount = definition.instanceCount
      this.tileResources[i] = resources
    }
  }

  private allocateRenderTargets(): void {
    const { scaledWidth, scaledHeight } = this
    for (let i = 0; i < this.contentTextures.length; i += 1) {
      const existing = this.contentTextures[i]
      if (existing) {
        this.gl.deleteTexture(existing)
      }
      this.contentTextures[i] = createFramebufferTexture(
        this.gl,
        scaledWidth,
        scaledHeight,
        {
          internalFormat: this.gl.RGBA8,
          format: this.gl.RGBA,
          type: this.gl.UNSIGNED_BYTE,
          filter: this.gl.NEAREST,
        },
      )
    }
  }

  private renderFullFrame(): void {
    const startTime = performance.now()
    this.populateBackground()
    this.populateGlyphInstances()

    const activeTexture = this.contentTextures[this.activeTextureIndex]
    if (!this.framebuffer || !activeTexture) {
      return
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer)
    bindFramebufferTexture(this.gl, this.framebuffer, activeTexture)
    this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)
    this.gl.disable(this.gl.SCISSOR_TEST)
    this.gl.clearColor(0, 0, 0, 1)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    this.backgroundTexture.uploadIfDirty()
    this.drawBackground()
    this.drawTiles()

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)
    this.drawPresent()
    this.drawCursorOverlay()
    this.updateDiagnosticsFrameHash()

    const frameDuration = performance.now() - startTime
    this.diagnosticsState = {
      ...this.diagnosticsState,
      lastFrameDurationMs: frameDuration,
      lastDrawCallCount: 3,
      gpuFrameDurationMs: frameDuration,
    }
    this.damageTracker.clear()
    this.lastCursorPosition = { ...this.snapshot.cursor }
  }

  private renderDamagedFrame(): void {
    if (!this.damageTracker.hasWork()) {
      return
    }

    const scrollLines = this.damageTracker.scrollLines
    let performedScroll = false
    if (scrollLines !== 0) {
      performedScroll = this.performScrollBitblt(scrollLines)
      this.damageTracker.scrollLines = 0
      if (!performedScroll) {
        this.damageTracker.clear()
        this.renderFullFrame()
        return
      }
    }

    const exposedRows = this.damageTracker.consumeExposedRows()
    if (exposedRows.length > 0) {
      const uniqueRows = Array.from(new Set(exposedRows))
      const selectionSegments = this.snapshot.selection
        ? new Map(
            getSelectionRowSegments(
              this.snapshot.selection,
              this.snapshot.columns,
            ).map((segment) => [segment.row, segment] as const),
          )
        : null
      this.backgroundTexture.updateRows(
        this.snapshot,
        this.theme,
        uniqueRows,
        selectionSegments,
      )
      for (const row of uniqueRows) {
        for (const tileIndex of this.tileIndicesForRow(row)) {
          this.damageTracker.markTileDirty(tileIndex)
        }
      }
    }

    const dirtyTilesIndices = this.damageTracker.consumeDirtyTiles()
    if (dirtyTilesIndices.length === 0) {
      if (performedScroll) {
        this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)
        this.drawPresent()
        this.drawCursorOverlay()
        this.updateDiagnosticsFrameHash()
        this.damageTracker.clear()
        this.lastCursorPosition = { ...this.snapshot.cursor }
      } else {
        this.damageTracker.clear()
      }
      return
    }

    if (dirtyTilesIndices.length >= this.tileResources.length) {
      this.damageTracker.clear()
      this.renderFullFrame()
      return
    }

    const context = this.buildRenderContext()
    const tilesToRender: TileResources[] = []
    for (const index of dirtyTilesIndices) {
      const tile = this.tileResources[index]
      if (!tile) {
        continue
      }
      this.populateTileInstances(tile, context)
      tilesToRender.push(tile)
    }

    if (tilesToRender.length === 0) {
      if (performedScroll) {
        this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)
        this.drawPresent()
        this.drawCursorOverlay()
        this.updateDiagnosticsFrameHash()
        this.damageTracker.clear()
        this.lastCursorPosition = { ...this.snapshot.cursor }
      } else {
        this.damageTracker.clear()
      }
      return
    }

    const activeTexture = this.contentTextures[this.activeTextureIndex]
    if (!this.framebuffer || !activeTexture) {
      this.damageTracker.clear()
      return
    }

    const start = performance.now()
    this.backgroundTexture.uploadIfDirty()

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer)
    bindFramebufferTexture(this.gl, this.framebuffer, activeTexture)
    this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)
    this.gl.enable(this.gl.SCISSOR_TEST)

    for (const tile of tilesToRender) {
      const { x, y, width, height } = tile.scissor
      this.gl.scissor(x, y, width, height)
      this.drawBackground()
      this.drawTiles([tile])
    }

    this.gl.disable(this.gl.SCISSOR_TEST)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)
    this.drawPresent()
    this.drawCursorOverlay()
    this.updateDiagnosticsFrameHash()

    const duration = performance.now() - start
    this.diagnosticsState = {
      ...this.diagnosticsState,
      lastFrameDurationMs: duration,
      lastDrawCallCount: tilesToRender.length * 2 + 1,
      gpuFrameDurationMs: duration,
      gpuDrawCallCount: tilesToRender.length * 2 + 1,
      gpuCellsProcessed: tilesToRender.reduce(
        (sum, tile) => sum + tile.instanceCount,
        0,
      ),
    }

    this.damageTracker.clear()
    this.lastCursorPosition = { ...this.snapshot.cursor }
  }

  private updateDiagnosticsFrameHash(): void {
    if (!this.captureDiagnosticsFrame) {
      this.diagnosticsState = { ...this.diagnosticsState, frameHash: undefined }
      return
    }
    const canvas = this.canvas as HTMLCanvasElement
    const width = canvas.width || 0
    const height = canvas.height || 0
    if (width === 0 || height === 0) {
      this.diagnosticsState = {
        ...this.diagnosticsState,
        frameHash: hashFrameBytes(new Uint8Array(0), width, height),
      }
      return
    }
    const gl = this.gl
    gl.finish()
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const frameHash = hashFrameBytes(pixels, width, height)
    this.diagnosticsState = { ...this.diagnosticsState, frameHash }
  }

  private populateBackground(): void {
    const selectionSegments = this.snapshot.selection
      ? new Map(
          getSelectionRowSegments(
            this.snapshot.selection,
            this.snapshot.columns,
          ).map((segment) => [segment.row, segment] as const),
        )
      : null

    this.backgroundTexture.updateFromSnapshot(
      this.snapshot,
      this.theme,
      selectionSegments,
      this.theme.selection,
    )
  }

  private handleUpdates(updates: ReadonlyArray<TerminalUpdate>): void {
    for (const update of updates) {
      switch (update.type) {
        case 'palette': {
          const resolved = resolvePaletteOverrideColor(
            update.color,
            this.theme,
            this.paletteOverrides,
            update.index,
          )
          if (resolved) {
            this.paletteOverrides.set(update.index, resolved)
            this.backgroundTexture.setPaletteOverride(update.index, resolved)
          } else {
            this.paletteOverrides.delete(update.index)
            this.backgroundTexture.setPaletteOverride(update.index, null)
          }
          this.markAllTilesDirty()
          break
        }
        default:
          break
      }
    }
  }

  private markDamageFromUpdates(
    updates: ReadonlyArray<TerminalUpdate>,
    _previousSnapshot: TerminalState,
  ): { requireFull: boolean } {
    let requireFull = false
    for (const update of updates) {
      switch (update.type) {
        case 'cells': {
          for (const cellUpdate of update.cells) {
            const tileIndex = this.tileIndexForCell(
              cellUpdate.row,
              cellUpdate.column,
            )
            this.damageTracker.markTileDirty(tileIndex)
            this.backgroundTexture.updateCell(
              cellUpdate.row,
              cellUpdate.column,
              cellUpdate.cell,
              this.theme,
            )
          }
          break
        }
        case 'scroll': {
          const amount = update.amount
          if (amount !== 0) {
            this.damageTracker.scrollLines += amount
            if (amount > 0) {
              const startRow = Math.max(0, this.rows - amount)
              for (let row = startRow; row < this.rows; row += 1) {
                this.damageTracker.markRowExposed(row)
              }
            } else {
              const count = Math.min(this.rows, -amount)
              for (let row = 0; row < count; row += 1) {
                this.damageTracker.markRowExposed(row)
              }
            }
          }
          break
        }
        case 'clear':
        case 'mode':
        case 'attributes':
        case 'scroll-region':
        case 'palette':
          this.markAllTilesDirty()
          requireFull = true
          break
        case 'cursor': {
          const previousCursor = this.lastCursorPosition
          this.damageTracker.markTileDirty(
            this.tileIndexForCell(previousCursor.row, previousCursor.column),
          )
          const nextCursor = this.snapshot.cursor
          this.damageTracker.markTileDirty(
            this.tileIndexForCell(nextCursor.row, nextCursor.column),
          )
          break
        }
        case 'cursor-visibility': {
          const cursor = this.snapshot.cursor
          this.damageTracker.markTileDirty(
            this.tileIndexForCell(cursor.row, cursor.column),
          )
          break
        }
        case 'selection-set':
        case 'selection-update':
        case 'selection-clear':
          this.markAllTilesDirty()
          break
        default:
          break
      }
    }
    return { requireFull }
  }

  private markAllTilesDirty(): void {
    for (let index = 0; index < this.tileResources.length; index += 1) {
      this.damageTracker.markTileDirty(index)
    }
  }

  private populateGlyphInstances(): void {
    const context = this.buildRenderContext()
    for (const tile of this.tileResources) {
      this.populateTileInstances(tile, context)
    }
  }

  private buildRenderContext(): RenderContext {
    const fallbackForegroundColor = this.snapshot.reverseVideo
      ? this.theme.background
      : this.theme.foreground
    const fallbackBackgroundColor = this.snapshot.reverseVideo
      ? this.theme.foreground
      : this.theme.background

    const fallbackForeground = rendererColorToRgba(fallbackForegroundColor)
    const selectionForeground = this.theme.selection?.foreground
      ? rendererColorToRgba(this.theme.selection.foreground)
      : null

    const selectionSegments = this.snapshot.selection
      ? new Map(
          getSelectionRowSegments(
            this.snapshot.selection,
            this.snapshot.columns,
          ).map((segment) => [segment.row, segment] as const),
        )
      : null

    return {
      fallbackForegroundColor,
      fallbackBackgroundColor,
      fallbackForeground,
      selectionForeground,
      selectionSegments,
    }
  }

  private populateTileInstances(
    tile: TileResources,
    context: RenderContext,
  ): void {
    const { definition, floatView, byteView } = tile
    const { col0, row0, cols, rows } = definition
    let instanceIndex = 0
    for (let row = 0; row < rows; row += 1) {
      const selectionSegment =
        context.selectionSegments?.get(row0 + row) ?? null
      for (let column = 0; column < cols; column += 1) {
        const absoluteRow = row0 + row
        const absoluteColumn = col0 + column
        const cell = this.getCell(absoluteRow, absoluteColumn)
        const glyph = this.glyphAtlas.ensureGlyph(cell)
        const metadata = computeGlyphRenderMetadata(cell, this.theme)

        const colors = resolveCellColorBytes(
          cell.attr,
          this.theme,
          this.paletteOverrides,
          context.fallbackForegroundColor,
          context.fallbackBackgroundColor,
        )

        const isSelected =
          selectionSegment !== null &&
          absoluteColumn >= selectionSegment.startColumn &&
          absoluteColumn <= selectionSegment.endColumn

        let foreground = (
          colors.foreground
            ? [...colors.foreground]
            : [
                context.fallbackForeground[0],
                context.fallbackForeground[1],
                context.fallbackForeground[2],
                0,
              ]
        ) as [number, number, number, number]

        if (isSelected) {
          const tint = metadata.selectionTint ?? context.selectionForeground
          if (tint) {
            foreground = [...tint] as [number, number, number, number]
          }
          foreground[3] = 255
        }

        const instanceBase = instanceIndex * INSTANCE_FLOAT_COUNT
        const cellOriginX = absoluteColumn * this.cellWidthPx
        const cellOriginY = absoluteRow * this.cellHeightPx

        floatView[instanceBase] = cellOriginX
        floatView[instanceBase + 1] = cellOriginY
        floatView[instanceBase + 2] = this.cellWidthPx * metadata.advanceCells
        floatView[instanceBase + 3] = this.cellHeightPx
        floatView[instanceBase + 4] = glyph.u0
        floatView[instanceBase + 5] = glyph.v0
        floatView[instanceBase + 6] = glyph.u1
        floatView[instanceBase + 7] = glyph.v1
        floatView[instanceBase + 8] = glyph.isColor ? 1 : 0

        const colorOffset =
          instanceIndex * INSTANCE_STRIDE_BYTES + INSTANCE_COLOR_OFFSET_BYTES
        byteView[colorOffset] = foreground[0]
        byteView[colorOffset + 1] = foreground[1]
        byteView[colorOffset + 2] = foreground[2]
        byteView[colorOffset + 3] = foreground[3]

        instanceIndex += 1
        column += metadata.skipTrailingColumns
      }
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, tile.buffer)
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      tile.arrayBuffer,
      this.gl.DYNAMIC_DRAW,
    )
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)
    tile.instanceCount = instanceIndex
  }

  private getCell(row: number, column: number): TerminalCell {
    const bufferRow = this.snapshot.buffer[row]
    const existing = bufferRow?.[column]
    if (existing) {
      return existing
    }
    return {
      char: ' ',
      attr: this.snapshot.attributes,
      protected: false,
    }
  }

  private tileIndexForCell(row: number, column: number): number {
    const tileColumn = Math.min(
      Math.max(Math.floor(column / TILE_WIDTH_CELLS), 0),
      Math.max(this.tileColumns - 1, 0),
    )
    const tileRow = Math.min(
      Math.max(Math.floor(row / TILE_HEIGHT_CELLS), 0),
      Math.max(this.tileRows - 1, 0),
    )
    return tileRow * Math.max(this.tileColumns, 1) + tileColumn
  }

  private tileIndicesForRow(row: number): number[] {
    if (this.tileColumns === 0 || row < 0 || row >= this.rows) {
      return []
    }
    const tileRow = Math.min(
      Math.max(Math.floor(row / TILE_HEIGHT_CELLS), 0),
      Math.max(this.tileRows - 1, 0),
    )
    const indices: number[] = []
    for (let tileColumn = 0; tileColumn < this.tileColumns; tileColumn += 1) {
      indices.push(tileRow * this.tileColumns + tileColumn)
    }
    return indices
  }

  private performScrollBitblt(scrollLines: number): boolean {
    const sourceIndex = this.activeTextureIndex
    const targetIndex = 1 - sourceIndex
    const sourceTexture = this.contentTextures[sourceIndex]
    const targetTexture = this.contentTextures[targetIndex]
    if (!this.framebuffer || !sourceTexture || !targetTexture) {
      return false
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer)
    bindFramebufferTexture(this.gl, this.framebuffer, targetTexture)
    this.gl.viewport(0, 0, this.scaledWidth, this.scaledHeight)

    this.gl.useProgram(this.scrollProgram)
    this.gl.bindVertexArray(this.quadVao)
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTexture)
    if (this.uniforms.scroll.sampler) {
      this.gl.uniform1i(this.uniforms.scroll.sampler, 0)
    }
    if (this.uniforms.scroll.offset) {
      const offset =
        (scrollLines * this.cellHeightPx) / Math.max(this.scaledHeight, 1)
      this.gl.uniform1f(this.uniforms.scroll.offset, offset)
    }
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    this.gl.bindVertexArray(null)
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)

    this.activeTextureIndex = targetIndex
    return true
  }

  private drawBackground(): void {
    const backgroundTexture = this.backgroundTexture.getTexture()
    this.gl.useProgram(this.backgroundProgram)
    this.gl.bindVertexArray(this.quadVao)
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, backgroundTexture)
    if (this.uniforms.background.textureSize) {
      this.gl.uniform2i(
        this.uniforms.background.textureSize,
        this.columns,
        this.rows,
      )
    }
    if (this.uniforms.background.sampler) {
      this.gl.uniform1i(this.uniforms.background.sampler, 0)
    }
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    this.gl.bindVertexArray(null)
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)
  }

  private drawTiles(
    tiles: ReadonlyArray<TileResources> = this.tileResources,
  ): void {
    this.gl.useProgram(this.tileProgram)
    if (this.uniforms.tile.viewportPx) {
      this.gl.uniform2f(
        this.uniforms.tile.viewportPx,
        this.scaledWidth,
        this.scaledHeight,
      )
    }
    this.gl.activeTexture(this.gl.TEXTURE0)
    if (this.uniforms.tile.atlas) {
      this.gl.uniform1i(this.uniforms.tile.atlas, 0)
    }

    const texture = this.glyphAtlas.getTexture(0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)

    for (const tile of tiles) {
      if (!tile.vao) {
        continue
      }
      this.gl.bindVertexArray(tile.vao)
      this.gl.drawArraysInstanced(
        this.gl.TRIANGLES,
        0,
        VERTICES_PER_GLYPH,
        tile.instanceCount,
      )
    }

    this.gl.bindVertexArray(null)
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)
  }

  private drawPresent(): void {
    const contentTexture = this.contentTextures[this.activeTextureIndex]
    if (!contentTexture) {
      return
    }
    this.gl.useProgram(this.presentProgram)
    this.gl.bindVertexArray(this.quadVao)
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, contentTexture)
    if (this.uniforms.present.sampler) {
      this.gl.uniform1i(this.uniforms.present.sampler, 0)
    }
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    this.gl.bindVertexArray(null)
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)
  }

  private drawCursorOverlay(): void {
    if (this.cursorOverlayStrategy) {
      if (!this.overlayContext) {
        return
      }
      this.cursorOverlayStrategy({
        ctx: this.overlayContext,
        snapshot: this.snapshot,
        metrics: this.metrics,
        theme: this.theme,
        selection: this._currentSelection,
      })
      return
    }
    this.drawDefaultCursorOverlay()
  }

  private drawDefaultCursorOverlay(): void {
    if (!this.snapshot.cursorVisible) {
      return
    }
    const cursor = this.snapshot.cursor
    const cursorTheme = this.theme.cursor
    const color = rendererColorToRgba(cursorTheme.color)
    const shape = cursorTheme.shape ?? 'block'

    const baseX = cursor.column * this.cellWidthPx
    const baseY = this.scaledHeight - (cursor.row + 1) * this.cellHeightPx

    let width = this.cellWidthPx
    let height = this.cellHeightPx
    switch (shape) {
      case 'underline':
        height = Math.max(1, Math.floor(this.cellHeightPx * 0.15))
        break
      case 'bar':
        width = Math.max(1, Math.floor(this.cellWidthPx * 0.2))
        break
      default:
        break
    }

    let cursorY = baseY
    if (shape === 'underline') {
      cursorY = baseY + this.cellHeightPx - height
    }

    this.gl.enable(this.gl.SCISSOR_TEST)
    this.gl.scissor(baseX, cursorY, width, height)
    const r = color[0] / 255
    const g = color[1] / 255
    const b = color[2] / 255
    this.gl.clearColor(r, g, b, 1)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
    this.gl.disable(this.gl.SCISSOR_TEST)
    this.gl.clearColor(0, 0, 0, 0)
  }
}

export const createWebglCanvasRenderer = (
  options: CanvasRendererOptions,
  gl: WebGL2RenderingContext,
  config: WebglBackendConfig,
): CanvasRenderer => new WebglCanvasRenderer(options, gl, config)
