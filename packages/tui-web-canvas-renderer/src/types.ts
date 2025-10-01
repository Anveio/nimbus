import type {
  SosPmApcKind,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from '@mana/vt'

export type RendererColor = string

export interface CanvasLike {
  width: number
  height: number
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D | null
  getContext(
    contextId: 'webgl' | 'webgl2' | 'experimental-webgl',
    options?: WebGLContextAttributes,
  ): WebGLRenderingContext | WebGL2RenderingContext | null
  getContext(contextId: 'webgpu'): unknown | null
}

export type RendererBackendKind = 'cpu-2d' | 'gpu-webgl' | 'gpu-webgpu'

export interface RendererPalette {
  /**
   * ANSI palette (index 0–15). Consumers should provide at least 16 entries.
   */
  readonly ansi: ReadonlyArray<RendererColor>
  /**
   * Optional 256-colour extension (indices 16–255).
   */
  readonly extended?: ReadonlyArray<RendererColor>
}

export interface RendererCursorTheme {
  readonly color: RendererColor
  /**
   * Cursor opacity in the range `[0, 1]`. Defaults to `1` (opaque) when omitted.
   */
  readonly opacity?: number
  readonly shape?: 'block' | 'underline' | 'bar'
}

export interface RendererSelectionTheme {
  readonly background: RendererColor
  readonly foreground?: RendererColor
}

export interface RendererTheme {
  readonly background: RendererColor
  readonly foreground: RendererColor
  readonly cursor: RendererCursorTheme
  readonly selection?: RendererSelectionTheme
  readonly palette: RendererPalette
}

export interface RendererFontMetrics {
  /** Font family string used when configuring the drawing context. */
  readonly family: string
  /** Font size in CSS pixels. */
  readonly size: number
  /** Additional letter spacing applied between cells, in CSS pixels. */
  readonly letterSpacing: number
  /** Line height multiplier relative to the font size. */
  readonly lineHeight: number
}

export interface RendererCellMetrics {
  /** Logical cell width in CSS pixels (before DPR scaling). */
  readonly width: number
  /** Logical cell height in CSS pixels (before DPR scaling). */
  readonly height: number
  /** Baseline offset from the top of the cell, in CSS pixels. */
  readonly baseline: number
}

export interface RendererMetrics {
  /** Device pixel ratio used to scale the backing store. */
  readonly devicePixelRatio: number
  readonly font: RendererFontMetrics
  readonly cell: RendererCellMetrics
}

export type RendererBackendFallback = 'cpu-only' | 'prefer-gpu' | 'require-gpu'

export interface Cpu2dBackendConfig {
  readonly type: 'cpu-2d'
}

export interface WebglBackendConfig {
  readonly type: 'gpu-webgl'
  readonly contextAttributes?: WebGLContextAttributes
  readonly fallback?: RendererBackendFallback
}

export interface WebgpuBackendConfig {
  readonly type: 'gpu-webgpu'
  readonly fallback?: RendererBackendFallback
  /**
   * Placeholder for WebGPU adapter configuration. We will refine these fields
   * once the WebGPU backend moves beyond the planning stage.
   */
  readonly deviceDescriptor?: unknown
  readonly canvasConfiguration?: unknown
}

export type RendererBackendConfig =
  | Cpu2dBackendConfig
  | WebglBackendConfig
  | WebgpuBackendConfig

export interface RendererBackendProbeContext {
  readonly canvas?: CanvasLike
  readonly webgl?: {
    readonly contextAttributes?: WebGLContextAttributes
  }
  readonly webgpu?: {
    /** Adapter/device hints for future WebGPU probing. */
    readonly deviceDescriptor?: unknown
    readonly canvasConfiguration?: unknown
  }
}

export interface RendererBackendProbeResult {
  readonly kind: RendererBackendKind
  readonly supported: boolean
  readonly reason?: string
}

export interface RendererBackendProvider<
  TConfig extends RendererBackendConfig,
  TResult extends RendererBackendProbeResult = RendererBackendProbeResult,
> {
  readonly kind: RendererBackendKind
  readonly matches: (config: RendererBackendConfig) => config is TConfig
  readonly normalizeConfig: (config?: TConfig) => TConfig
  readonly probe: (
    context: RendererBackendProbeContext,
    config: TConfig,
  ) => TResult
  readonly create: (
    options: CanvasRendererOptions,
    config: TConfig,
    probe: TResult,
  ) => CanvasRenderer
}

export interface DetectPreferredBackendOptions
  extends RendererBackendProbeContext {
  readonly fallback?: RendererBackendFallback
  /**
   * Legacy entry point for WebGL context attributes. Prefer
   * `webgl.contextAttributes` so additional backends can co-exist without
   * overloading the shared namespace.
   */
  readonly contextAttributes?: WebGLContextAttributes
}

export interface CanvasRendererOptions {
  readonly canvas: CanvasLike
  readonly metrics: RendererMetrics
  readonly theme: RendererTheme
  /**
   * Initial interpreter snapshot used to paint the full screen buffer.
   */
  readonly snapshot: TerminalState
  readonly onSelectionChange?: (selection: TerminalSelection | null) => void
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
  readonly backend?: RendererBackendConfig
}

export interface CanvasRendererUpdateOptions {
  readonly snapshot: TerminalState
  readonly updates: ReadonlyArray<TerminalUpdate>
}

export interface CanvasRendererResizeOptions {
  readonly snapshot: TerminalState
  readonly metrics: RendererMetrics
}

export interface CanvasRendererDiagnostics {
  /** Last frame render duration in milliseconds. */
  readonly lastFrameDurationMs: number | null
  /** Total number of draw calls in the most recent frame. */
  readonly lastDrawCallCount: number | null
  /** GPU-specific frame duration when applicable. */
  readonly gpuFrameDurationMs?: number | null
  /** GPU draw call count when applicable. */
  readonly gpuDrawCallCount?: number | null
  /** Number of terminal cells processed while preparing the last GPU frame. */
  readonly gpuCellsProcessed?: number | null
  /** Total bytes uploaded to GPU buffers for the last frame. */
  readonly gpuBytesUploaded?: number | null
  /** Portion (0-1) of the viewport touched by GPU geometry updates. */
  readonly gpuDirtyRegionCoverage?: number | null
  /** Bytes uploaded for cursor/selection overlay textures in the last frame. */
  readonly gpuOverlayBytesUploaded?: number | null
  /** Summary of per-row column metadata availability for the last frame. */
  readonly gpuRowMetadata?: RendererRowMetadataDiagnostics | null
  /** Most recent OSC payload observed, if any. */
  readonly lastOsc: {
    readonly identifier: string
    readonly data: string
  } | null
  /** Most recent SOS/PM/APC payload observed, if any. */
  readonly lastSosPmApc: {
    readonly kind: SosPmApcKind
    readonly data: string
  } | null
  /** Most recent DCS payload observed, if any. */
  readonly lastDcs: {
    readonly finalByte: number
    readonly params: ReadonlyArray<number>
    readonly intermediates: ReadonlyArray<number>
    readonly data: string
  } | null
}

export interface RendererRowMetadataDiagnostics {
  readonly rowsWithColumnOffsets: number
  readonly rowsWithoutColumnOffsets: number
  readonly disabledBySelection: number
  readonly disabledByWideGlyph: number
  readonly disabledByOverlay: number
  readonly disabledByOther: number
}

export type CursorOverlayStrategy = (options: {
  readonly ctx: CanvasRenderingContext2D
  readonly snapshot: TerminalState
  readonly metrics: RendererMetrics
  readonly theme: RendererTheme
  readonly selection: TerminalSelection | null
}) => void

export interface CanvasRenderer {
  readonly canvas: CanvasLike
  applyUpdates(options: CanvasRendererUpdateOptions): void
  resize(options: CanvasRendererResizeOptions): void
  setTheme(theme: RendererTheme): void
  /** Resynchronise the canvas with the entire snapshot (full repaint). */
  sync(snapshot: TerminalState): void
  dispose(): void
  readonly diagnostics: CanvasRendererDiagnostics
  readonly currentSelection: TerminalSelection | null
  onSelectionChange?: (selection: TerminalSelection | null) => void
}

export type CreateCanvasRenderer = (
  options: CanvasRendererOptions,
) => CanvasRenderer
