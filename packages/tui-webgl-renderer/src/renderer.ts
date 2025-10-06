import {
  createTerminalRuntime,
  type TerminalRuntime,
  type TerminalState,
} from '@mana/vt'
import { createWebglContext } from './gl/context'
import { createFullScreenQuad, disposeFullScreenQuad } from './gl/quad'
import { createProgram } from './gl/shader'
import { createListenerRegistry } from './internal/listener-registry'
import { mergeTerminalProfile } from './internal/profile'
import {
  applyRendererEventToRuntime,
  type RuntimeBridgeResult,
} from './internal/runtime-bridge'
import { TextSurfaceRenderer } from './internal/text-surface'
import type {
  CreateRendererOptions,
  RendererConfiguration,
  RendererEvent,
  RendererFrameEvent,
  RendererInstance,
  RendererResizeRequestEvent,
  RenderSurface,
  TerminalProfile,
  WebglRendererConfig,
  WebglRendererFrameMetadata,
  WebglRendererInstance,
} from './types'

const DEFAULT_PROFILE: TerminalProfile = {}

const DEFAULT_CONFIG: WebglRendererConfig = {
  autoFlush: true,
}

type FrameHandle = number | ReturnType<typeof setTimeout>

const requestFrame: (callback: FrameRequestCallback) => FrameHandle =
  typeof window !== 'undefined' && window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (callback: FrameRequestCallback) =>
        setTimeout(() => callback(Date.now()), 16)

const cancelFrame = (handle: FrameHandle): void => {
  if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(handle as number)
    return
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>)
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

export class WebglRenderer
  implements WebglRendererInstance, RendererInstance<WebglRendererConfig>
{
  readonly runtime: TerminalRuntime

  private _profile: TerminalProfile
  private _configuration?: RendererConfiguration
  private readonly rendererConfig: WebglRendererConfig

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

  private freed = false
  private frameHandle: FrameHandle | null = null
  private pendingFrame: FrameState | null = null
  private lastFrameTimestamp: number | null = null

  constructor(
    runtime: TerminalRuntime,
    profile: TerminalProfile,
    config: WebglRendererConfig,
  ) {
    this.runtime = runtime
    this._profile = profile
    this.rendererConfig = { ...DEFAULT_CONFIG, ...config }
  }

  get profile(): TerminalProfile {
    return this._profile
  }

  get configuration(): RendererConfiguration | undefined {
    return this._configuration
  }

  mount(surface: RenderSurface<WebglRendererConfig>): void {
    if (this.freed) {
      throw new Error('Renderer has been freed and cannot be remounted')
    }
    const renderRoot = surface.renderRoot
    if (!(renderRoot instanceof HTMLElement)) {
      throw new Error('Renderer surface must provide an HTMLElement renderRoot')
    }

    let canvas: HTMLCanvasElement | null = null
    let ownsCanvas = false
    if (renderRoot instanceof HTMLCanvasElement) {
      canvas = renderRoot
    } else if (this.rendererConfig.renderRoot instanceof HTMLCanvasElement) {
      canvas = this.rendererConfig.renderRoot
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
      this.scheduleFrame('initial')
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
      this.scheduleFrame('resize')
      return
    }

    if (event.type === 'profile.update') {
      this._profile = mergeTerminalProfile(this._profile, event.profile)
      this.scheduleFrame('theme-change')
      return
    }

    const result: RuntimeBridgeResult = applyRendererEventToRuntime(
      this.runtime,
      event,
    )

    if (result.handled) {
      const reason = result.batch ? result.batch.reason : 'sync'
      this.scheduleFrame(reason)
      return
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
    if (this.frameHandle !== null) {
      cancelFrame(this.frameHandle)
      this.frameHandle = null
    }
    this.pendingFrame = null
    this.runtime.reset()
    this.texture = null
    this.freed = true
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
      attributes: this.rendererConfig.contextAttributes,
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

  private scheduleFrame(reason: FrameReason): void {
    if (this.freed) {
      return
    }
    this.pendingFrame = { reason }
    if (this.frameHandle !== null) {
      return
    }
    this.frameHandle = requestFrame((timestamp) => {
      this.frameHandle = null
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

    const snapshot: TerminalState = this.runtime.snapshot
    const overlays = {
      selection:
        this._profile.overlays?.selection ?? snapshot.selection ?? null,
      cursor: this._profile.overlays?.cursor ?? null,
      highlights: this._profile.overlays?.highlights,
      layers: this._profile.overlays?.layers,
    }

    const rendered = this.textRenderer.render(
      snapshot,
      this._configuration,
      this._profile,
      overlays,
    )

    const { gl } = this
    const width = this.getFramebufferWidth(this._configuration)
    const height = this.getFramebufferHeight(this._configuration)

    gl.viewport(0, 0, width, height)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rendered.canvas,
    )

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)

    if (this.rendererConfig.autoFlush) {
      gl.flush()
    }

    const approxFrameDuration =
      this.lastFrameTimestamp !== null
        ? timestamp - this.lastFrameTimestamp
        : null
    this.lastFrameTimestamp = timestamp

    const frameEvent: RendererFrameEvent<WebglRendererFrameMetadata> = {
      timestamp,
      approxFrameDuration,
      metadata: {
        reason,
        drawCallCount: 1,
        grid: { rows: snapshot.rows, columns: snapshot.columns },
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
          bytesUploaded: width * height * 4,
          dirtyRegionCoverage: 1,
        },
        osc: null,
        sosPmApc: snapshot.lastSosPmApc,
        dcs: null,
        frameHash: undefined,
      },
    }

    this.frameListeners.emit(frameEvent)
  }
}

export const createRenderer = async (
  options: CreateRendererOptions<WebglRendererConfig>,
): Promise<WebglRendererInstance> => {
  const runtime = options.runtime ?? createTerminalRuntime({})
  const profile = options.profile ?? DEFAULT_PROFILE
  const rendererConfig: WebglRendererConfig = {
    contextAttributes: options.contextAttributes,
    autoFlush: options.autoFlush,
    renderRoot: options.renderRoot,
  }
  const renderer = new WebglRenderer(runtime, profile, rendererConfig)
  renderer.dispatch({
    type: 'renderer.configure',
    configuration: options.rendererConfig,
  })
  return renderer
}
