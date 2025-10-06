import {
  createTerminalRuntime,
  type TerminalRuntime,
  type TerminalState,
} from '@mana/vt'
import { createWebglContext } from './gl/context'
import { createFullScreenQuad, disposeFullScreenQuad } from './gl/quad'
import { createProgram } from './gl/shader'
import { TILE_HEIGHT_CELLS, TILE_WIDTH_CELLS } from './internal/constants'
import { DamageTracker } from './internal/damage-tracker'
import { FrameScheduler } from './internal/frame-scheduler'
import { createListenerRegistry } from './internal/listener-registry'
import { mergeTerminalProfile } from './internal/profile'
import {
  applyRendererEventToRuntime,
  type RuntimeBridgeResult,
} from './internal/runtime-bridge'
import { TextSurfaceRenderer } from './internal/text-surface'
import type {
  RendererConfiguration,
  RendererDirtyRegion,
  RendererEvent,
  RendererFrameEvent,
  RendererMountDescriptor,
  RendererResizeRequestEvent,
  RendererRoot,
  RendererRootContainer,
  RenderSurface,
  RuntimeUpdateBatch,
  TerminalProfile,
  WebglRendererConfig,
  WebglRendererFrameMetadata,
  WebglRendererSession,
} from './types'

const DEFAULT_PROFILE: TerminalProfile = {}

const DEFAULT_CONFIG: WebglRendererConfig = {
  autoFlush: true,
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = (aPosition * 0.5) + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uTexture, vUv);
}`

type FrameReason =
  | 'initial'
  | 'apply-updates'
  | 'sync'
  | 'resize'
  | 'theme-change'
  | 'manual'

interface SurfaceState {
  readonly root: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly ownsCanvas: boolean
}

interface FrameState {
  reason: FrameReason
}

interface WebglRendererSessionLifecycleHooks {
  readonly onUnmount?: () => void
  readonly onFree?: () => void
}

interface WebglRendererSessionInit {
  readonly runtime: TerminalRuntime
  readonly profile: TerminalProfile
  readonly rendererConfig: WebglRendererConfig
  readonly surface: RenderSurface<WebglRendererConfig>
  readonly configuration: RendererConfiguration
  readonly lifecycle?: WebglRendererSessionLifecycleHooks
}

class WebglRendererSessionImpl implements WebglRendererSession {
  readonly runtime: TerminalRuntime

  private _profile: TerminalProfile
  private _configuration?: RendererConfiguration
  private readonly config: WebglRendererConfig
  private readonly lifecycle: WebglRendererSessionLifecycleHooks

  private surface: SurfaceState | null = null
  private gl: WebGL2RenderingContext | null = null
  private glDispose: (() => void) | null = null
  private program: WebGLProgram | null = null
  private texture: WebGLTexture | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vertexBuffer: WebGLBuffer | null = null

  private readonly textRenderer = new TextSurfaceRenderer()
  private readonly frameListeners = createListenerRegistry<RendererFrameEvent>()
  private readonly resizeListeners =
    createListenerRegistry<RendererResizeRequestEvent>()
  private readonly scheduler = new FrameScheduler()
  private readonly damageTracker = new DamageTracker()
  private pendingBatches: RuntimeUpdateBatch[] = []

  private freed = false
  private pendingFrame: FrameState | null = null
  private lastFrameTimestamp: number | null = null
  private needsFullRedraw = true
  private tileColumns = 0
  private tileRows = 0
  private lastCursorTile: number | null = null

  constructor(init: WebglRendererSessionInit) {
    this.runtime = init.runtime
    this._profile = init.profile
    this.config = { ...DEFAULT_CONFIG, ...init.rendererConfig }
    this.lifecycle = init.lifecycle ?? {}

    this.dispatch({
      type: 'renderer.configure',
      configuration: init.configuration,
    })

    this.attachSurface(init.surface)
  }

  get profile(): TerminalProfile {
    return this._profile
  }

  get configuration(): RendererConfiguration | undefined {
    return this._configuration
  }

  private attachSurface(surface: RenderSurface<WebglRendererConfig>): void {
    if (this.freed) {
      throw new Error('Renderer has been freed and cannot be remounted')
    }
    const renderRoot = surface.renderRoot
    if (
      typeof HTMLElement !== 'undefined' &&
      !(renderRoot instanceof HTMLElement)
    ) {
      throw new Error('Renderer surface must provide an HTMLElement renderRoot')
    }

    let canvas: HTMLCanvasElement | null = null
    let ownsCanvas = false
    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      renderRoot instanceof HTMLCanvasElement
    ) {
      canvas = renderRoot
    } else if (this.config.renderRoot instanceof HTMLCanvasElement) {
      canvas = this.config.renderRoot
      renderRoot.append(canvas)
      ownsCanvas = true
    } else {
      canvas = document.createElement('canvas')
      renderRoot.append(canvas)
      ownsCanvas = true
    }

    this.surface = { root: renderRoot, canvas, ownsCanvas }

    this.initializeGl(canvas)

    if (this._configuration) {
      this.applyConfigurationDimensions(canvas, this._configuration)
      this.updateTileDimensions()
      this.needsFullRedraw = true
      this.requestFrame('initial')
    }
  }

  unmount(): void {
    if (!this.surface) {
      return
    }
    if (this.surface.ownsCanvas) {
      this.surface.canvas.remove()
    }
    this.surface = null
    this.disposeGl()
    this.lifecycle.onUnmount?.()
  }

  dispatch(event: RendererEvent<WebglRendererConfig>): void {
    if (this.freed) {
      throw new Error('Cannot dispatch events after renderer has been freed')
    }

    if (event.type === 'renderer.configure') {
      this._configuration = event.configuration
      if (this.surface) {
        this.applyConfigurationDimensions(
          this.surface.canvas,
          event.configuration,
        )
      } else {
        this.textRenderer.resize(
          this.getFramebufferWidth(event.configuration),
          this.getFramebufferHeight(event.configuration),
        )
      }
      this.updateTileDimensions()
      this.needsFullRedraw = true
      this.lastCursorTile = null
      this.requestFrame('sync')
      return
    }

    if (event.type === 'profile.update') {
      this._profile = mergeTerminalProfile(this._profile, event.profile)
      this.needsFullRedraw = true
      this.lastCursorTile = null
      this.requestFrame('theme-change')
      return
    }

    if (event.type.startsWith('runtime.')) {
      const result: RuntimeBridgeResult = applyRendererEventToRuntime(
        this.runtime,
        event,
      )

      if (result.handled) {
        if (result.batch) {
          this.pendingBatches.push(result.batch)
          this.recordBatchDamage(result.batch)
          const reason = result.batch.reason ?? 'apply-updates'
          this.requestFrame(reason)
        } else {
          this.requestFrame('sync')
        }
        return
      }
    }
    throw new Error(
      `Unsupported renderer event type: ${(event as RendererEvent).type}`,
    )
  }

  onFrame(listener: (event: RendererFrameEvent) => void): () => void {
    return this.frameListeners.add(listener)
  }

  onResizeRequest(
    listener: (event: RendererResizeRequestEvent) => void,
  ): () => void {
    return this.resizeListeners.add(listener)
  }

  free(): void {
    if (this.freed) {
      return
    }
    this.unmount()
    this.frameListeners.clear()
    this.resizeListeners.clear()
    this.scheduler.cancel()
    this.pendingFrame = null
    this.pendingBatches = []
    this.damageTracker.clear()
    this.runtime.reset()
    this.texture = null
    this.freed = true
    this.lifecycle.onFree?.()
  }

  serializeBuffer(): Promise<Uint8Array> {
    if (!this.gl || !this._configuration) {
      return Promise.resolve(new Uint8Array())
    }
    const { gl } = this
    const width = this.getFramebufferWidth(this._configuration)
    const height = this.getFramebufferHeight(this._configuration)
    const buffer = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer)
    return Promise.resolve(buffer)
  }

  private initializeGl(canvas: HTMLCanvasElement): void {
    if (this.gl) {
      return
    }
    const { gl, dispose } = createWebglContext({
      canvas,
      attributes: this.config.contextAttributes,
    })
    this.gl = gl
    this.glDispose = dispose

    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    gl.useProgram(program)
    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('Failed to create texture for renderer')
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.disable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 1)

    const textureUniform = gl.getUniformLocation(program, 'uTexture')
    if (textureUniform) {
      gl.uniform1i(textureUniform, 0)
    }

    const { vao, vertexBuffer } = createFullScreenQuad(gl)

    this.program = program
    this.texture = texture
    this.vao = vao
    this.vertexBuffer = vertexBuffer
  }

  private disposeGl(): void {
    if (!this.gl) {
      return
    }
    const { gl } = this
    if (this.program) {
      gl.deleteProgram(this.program)
      this.program = null
    }
    if (this.texture) {
      gl.deleteTexture(this.texture)
      this.texture = null
    }
    disposeFullScreenQuad(gl, this.vao, this.vertexBuffer)
    this.vao = null
    this.vertexBuffer = null
    this.glDispose?.()
    this.glDispose = null
    this.gl = null
  }

  private applyConfigurationDimensions(
    canvas: HTMLCanvasElement,
    configuration: RendererConfiguration,
  ): void {
    const width = this.getFramebufferWidth(configuration)
    const height = this.getFramebufferHeight(configuration)

    canvas.width = width
    canvas.height = height
    canvas.style.width = `${configuration.cssPixels.width}px`
    canvas.style.height = `${configuration.cssPixels.height}px`
    this.textRenderer.resize(width, height)
  }

  private getFramebufferWidth(configuration: RendererConfiguration): number {
    if (configuration.framebufferPixels) {
      return configuration.framebufferPixels.width
    }
    return Math.max(
      1,
      Math.round(
        configuration.cssPixels.width * configuration.devicePixelRatio,
      ),
    )
  }

  private getFramebufferHeight(configuration: RendererConfiguration): number {
    if (configuration.framebufferPixels) {
      return configuration.framebufferPixels.height
    }
    return Math.max(
      1,
      Math.round(
        configuration.cssPixels.height * configuration.devicePixelRatio,
      ),
    )
  }

  private requestFrame(reason: FrameReason): void {
    if (this.freed) {
      return
    }
    this.pendingFrame = { reason }
    this.scheduler.request((timestamp) => {
      const frame = this.pendingFrame
      this.pendingFrame = null
      if (!frame) {
        return
      }
      this.renderFrame(frame.reason, timestamp)
    })
  }

  private renderFrame(reason: FrameReason, timestamp: number): void {
    if (
      !this.surface ||
      !this.gl ||
      !this.texture ||
      !this.program ||
      !this._configuration
    ) {
      return
    }

    if (
      !this.needsFullRedraw &&
      !this.damageTracker.hasWork() &&
      this.pendingBatches.length === 0 &&
      reason === 'sync'
    ) {
      return
    }

    const snapshot: TerminalState = this.runtime.snapshot
    const overlays = {
      selection:
        this._profile.overlays?.selection ?? snapshot.selection ?? null,
      cursor: this._profile.overlays?.cursor ?? null,
      highlights: this._profile.overlays?.highlights,
      layers: this._profile.overlays?.layers,
    }

    const regions = this.resolveRenderRegions(snapshot)

    const rendered = this.textRenderer.render(
      snapshot,
      this._configuration,
      this._profile,
      overlays,
      regions,
    )

    const { gl } = this
    const width = this.getFramebufferWidth(this._configuration)
    const height = this.getFramebufferHeight(this._configuration)

    gl.viewport(0, 0, width, height)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    const fullUpload = !regions || regions.length === 0 || this.needsFullRedraw

    if (fullUpload) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rendered.canvas,
      )
      this.needsFullRedraw = false
    } else {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      const dpr = this._configuration.devicePixelRatio
      const cellWidth = this._configuration.cell.width
      const cellHeight = this._configuration.cell.height
      for (const region of regions) {
        const xCss = region.columnStart * cellWidth
        const yCss = region.rowStart * cellHeight
        const widthCss = (region.columnEnd - region.columnStart) * cellWidth
        const heightCss = (region.rowEnd - region.rowStart) * cellHeight
        const xPx = Math.floor(xCss * dpr)
        const yPx = Math.floor(yCss * dpr)
        const widthPx = Math.max(1, Math.ceil(widthCss * dpr))
        const heightPx = Math.max(1, Math.ceil(heightCss * dpr))
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          xPx,
          yPx,
          widthPx,
          heightPx,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          rendered.canvas,
        )
      }
    }

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)

    if (this.config.autoFlush) {
      gl.flush()
    }

    const approxFrameDuration =
      this.lastFrameTimestamp !== null
        ? timestamp - this.lastFrameTimestamp
        : null
    this.lastFrameTimestamp = timestamp

    const dirtyRegionMetrics = this.computeDirtyMetrics(
      snapshot,
      regions,
      fullUpload,
    )

    const aggregatedUpdates = this.pendingBatches.flatMap(
      (batch) => batch.updates,
    )
    const gridConfig = this._configuration.grid

    const frameEvent: RendererFrameEvent<WebglRendererFrameMetadata> = {
      timestamp,
      approxFrameDuration,
      dirtyRegion: dirtyRegionMetrics?.dirtyRegion,
      metadata: {
        reason,
        drawCallCount: 1,
        grid: { rows: gridConfig.rows, columns: gridConfig.columns },
        cssPixels: this._configuration.cssPixels,
        framebufferPixels: this._configuration.framebufferPixels ?? {
          width,
          height,
        },
      },
      diagnostics: {
        lastFrameDurationMs: approxFrameDuration,
        lastDrawCallCount: 1,
        gpu: {
          frameDurationMs: approxFrameDuration,
          drawCallCount: 1,
          bytesUploaded:
            dirtyRegionMetrics?.bytesUploaded ?? width * height * 4,
          dirtyRegionCoverage: dirtyRegionMetrics?.coverage ?? 1,
        },
        osc: null,
        sosPmApc: snapshot.lastSosPmApc,
        dcs: null,
        frameHash: undefined,
      },
      updates: aggregatedUpdates,
      viewport: { rows: gridConfig.rows, columns: gridConfig.columns },
    }

    this.frameListeners.emit(frameEvent)
    const currentCursorTile = this.tileIndexForPosition(
      snapshot.cursor.row,
      snapshot.cursor.column,
    )
    if (currentCursorTile !== null) {
      this.lastCursorTile = currentCursorTile
    }
    this.pendingBatches = []
    this.damageTracker.clear()
  }

  private resolveRenderRegions(
    _snapshot: TerminalState,
  ): RendererDirtyRegion[] | null {
    if (this.needsFullRedraw) {
      return null
    }
    if (this.damageTracker.overlayChanged) {
      this.needsFullRedraw = true
      return null
    }
    const dirtyTiles = this.damageTracker.consumeDirtyTiles()
    if (dirtyTiles.length === 0) {
      return null
    }
    const configuration = this._configuration
    if (!configuration) {
      return null
    }
    const rows = configuration.grid.rows
    const columns = configuration.grid.columns
    const regions: RendererDirtyRegion[] = []
    for (const index of dirtyTiles) {
      const tile = this.tileFromIndex(index)
      if (!tile) {
        continue
      }
      const rowStart = tile.y * TILE_HEIGHT_CELLS
      const columnStart = tile.x * TILE_WIDTH_CELLS
      const rowEnd = Math.min(rows, rowStart + TILE_HEIGHT_CELLS)
      const columnEnd = Math.min(columns, columnStart + TILE_WIDTH_CELLS)
      if (rowStart >= rowEnd || columnStart >= columnEnd) {
        continue
      }
      regions.push({
        rowStart,
        rowEnd,
        columnStart,
        columnEnd,
      })
    }
    return regions.length > 0 ? regions : null
  }

  private computeDirtyMetrics(
    snapshot: TerminalState,
    regions: RendererDirtyRegion[] | null,
    fullUpload: boolean,
  ): {
    dirtyRegion: { rows: number; columns: number }
    bytesUploaded: number
    coverage: number
  } | null {
    if (fullUpload) {
      return {
        dirtyRegion: { rows: snapshot.rows, columns: snapshot.columns },
        bytesUploaded:
          this.getFramebufferWidth(this._configuration!) *
          this.getFramebufferHeight(this._configuration!) *
          4,
        coverage: 1,
      }
    }
    if (!regions || regions.length === 0) {
      return null
    }

    const uniqueRows = new Set<number>()
    const uniqueColumns = new Set<number>()
    let uploadedBytes = 0
    const dpr = this._configuration!.devicePixelRatio
    const cellWidth = this._configuration!.cell.width
    const cellHeight = this._configuration!.cell.height
    for (const region of regions) {
      for (let row = region.rowStart; row < region.rowEnd; row += 1) {
        uniqueRows.add(row)
      }
      for (
        let column = region.columnStart;
        column < region.columnEnd;
        column += 1
      ) {
        uniqueColumns.add(column)
      }
      const widthCss = (region.columnEnd - region.columnStart) * cellWidth
      const heightCss = (region.rowEnd - region.rowStart) * cellHeight
      const widthPx = Math.max(1, Math.ceil(widthCss * dpr))
      const heightPx = Math.max(1, Math.ceil(heightCss * dpr))
      uploadedBytes += widthPx * heightPx * 4
    }
    const totalPixels =
      this.getFramebufferWidth(this._configuration!) *
      this.getFramebufferHeight(this._configuration!)
    const pixelsUploaded = uploadedBytes / 4
    const coverage = Math.min(
      1,
      totalPixels === 0 ? 0 : pixelsUploaded / totalPixels,
    )
    return {
      dirtyRegion: {
        rows: uniqueRows.size,
        columns: uniqueColumns.size,
      },
      bytesUploaded: uploadedBytes,
      coverage: coverage || 0,
    }
  }

  private recordBatchDamage(batch: RuntimeUpdateBatch): void {
    if (!this._configuration) {
      this.needsFullRedraw = true
      return
    }
    if (batch.reason === 'initial') {
      this.needsFullRedraw = true
    }
    const tileColumns = this.tileColumns
    const markTile = (row: number, column: number): number | null => {
      if (row < 0 || column < 0 || tileColumns <= 0) {
        this.needsFullRedraw = true
        return null
      }
      const tileX = Math.floor(column / TILE_WIDTH_CELLS)
      const tileY = Math.floor(row / TILE_HEIGHT_CELLS)
      if (tileX < 0 || tileY < 0) {
        return null
      }
      const index = tileY * tileColumns + tileX
      this.damageTracker.markTileDirty(index)
      return index
    }

    for (const update of batch.updates ?? []) {
      switch (update.type) {
        case 'cells': {
          for (const cell of update.cells) {
            markTile(cell.row, cell.column)
          }
          break
        }
        case 'cursor': {
          const previousTile = this.lastCursorTile
          const newTile = markTile(update.position.row, update.position.column)
          if (
            previousTile !== null &&
            previousTile !== newTile &&
            previousTile >= 0
          ) {
            this.damageTracker.markTileDirty(previousTile)
          }
          if (newTile !== null) {
            this.lastCursorTile = newTile
          }
          break
        }
        case 'selection-set':
        case 'selection-update':
        case 'selection-clear': {
          this.damageTracker.overlayChanged = true
          break
        }
        case 'clear':
        case 'scroll':
        case 'scroll-region':
        case 'palette':
        case 'mode':
        case 'attributes':
        case 'bell':
        case 'cursor-visibility':
        case 'c1-transmission':
        case 'dcs-start':
        case 'dcs-data':
        case 'dcs-end':
        case 'sos-pm-apc':
        case 'response': {
          this.needsFullRedraw = true
          break
        }
        default:
          break
      }
    }
  }

  private tileFromIndex(index: number): { x: number; y: number } | null {
    if (index < 0 || this.tileColumns <= 0) {
      return null
    }
    const x = index % this.tileColumns
    const y = Math.floor(index / this.tileColumns)
    return { x, y }
  }

  private tileIndexForPosition(row: number, column: number): number | null {
    if (row < 0 || column < 0 || this.tileColumns <= 0) {
      return null
    }
    const tileX = Math.floor(column / TILE_WIDTH_CELLS)
    const tileY = Math.floor(row / TILE_HEIGHT_CELLS)
    if (tileX < 0 || tileY < 0) {
      return null
    }
    return tileY * this.tileColumns + tileX
  }

  private updateTileDimensions(): void {
    if (!this._configuration) {
      this.tileColumns = 0
      this.tileRows = 0
      this.lastCursorTile = null
      return
    }
    this.tileColumns = Math.max(
      1,
      Math.ceil(this._configuration.grid.columns / TILE_WIDTH_CELLS),
    )
    this.tileRows = Math.max(
      1,
      Math.ceil(this._configuration.grid.rows / TILE_HEIGHT_CELLS),
    )
    this.lastCursorTile = null
  }
}

class WebglRendererRootImpl implements RendererRoot<WebglRendererConfig> {
  private _currentSession: WebglRendererSession | null = null
  private disposed = false

  constructor(readonly container: RendererRootContainer) {}

  get currentSession(): WebglRendererSession | null {
    return this._currentSession
  }

  mount(
    descriptor: RendererMountDescriptor<WebglRendererConfig>,
  ): WebglRendererSession {
    if (this.disposed) {
      throw new Error('Renderer root has been disposed')
    }

    const surface = descriptor.surface ?? this.inferSurface()

    const runtime = descriptor.runtime ?? createTerminalRuntime({})
    const profile = descriptor.profile ?? DEFAULT_PROFILE
    const rendererConfig: WebglRendererConfig = {
      contextAttributes: descriptor.contextAttributes,
      autoFlush: descriptor.autoFlush,
      renderRoot: descriptor.renderRoot,
    }

    const previous = this._currentSession
    if (previous) {
      previous.unmount()
      previous.free()
    }

    const session = new WebglRendererSessionImpl({
      runtime,
      profile,
      rendererConfig,
      surface,
      configuration: descriptor.configuration,
      lifecycle: {
        onFree: () => {
          if (this._currentSession === session) {
            this._currentSession = null
          }
        },
      },
    })

    this._currentSession = session
    return session
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    if (this._currentSession) {
      this._currentSession.unmount()
      this._currentSession.free()
      this._currentSession = null
    }

    ROOT_REGISTRY.delete(this.container)
  }

  private inferSurface(): RenderSurface<WebglRendererConfig> {
    if (
      typeof HTMLElement !== 'undefined' &&
      this.container instanceof HTMLElement
    ) {
      return { renderRoot: this.container }
    }

    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      this.container instanceof HTMLCanvasElement
    ) {
      return { renderRoot: this.container }
    }

    throw new Error(
      'Renderer root cannot derive a surface from the supplied container; provide descriptor.surface explicitly.',
    )
  }
}

const ROOT_REGISTRY = new WeakMap<
  RendererRootContainer,
  WebglRendererRootImpl
>()

export const createRendererRoot = (
  container: RendererRootContainer,
): RendererRoot<WebglRendererConfig> => {
  if (!container) {
    throw new Error('Renderer root container is required')
  }

  const existing = ROOT_REGISTRY.get(container)
  if (existing) {
    return existing
  }

  const root = new WebglRendererRootImpl(container)
  ROOT_REGISTRY.set(container, root)
  return root
}

export { WebglRendererSessionImpl }
