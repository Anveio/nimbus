import type {
  CursorPosition,
  ParserEvent,
  TerminalAttributes,
  TerminalPointerButton,
  TerminalPointerModifierState,
  TerminalRuntime,
  TerminalRuntimeCursorMoveDirection,
  TerminalRuntimeCursorMoveOptions,
  TerminalRuntimeHostEvent as TerminalRuntimeEvent,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from '@nimbus/vt'

/**
 * Renderer configuration as described by renderer-specification-v0.md §8.
 */
export interface RendererConfiguration {
  readonly grid: { readonly rows: number; readonly columns: number }
  readonly cssPixels: { readonly width: number; readonly height: number }
  readonly devicePixelRatio: number
  readonly framebufferPixels?: {
    readonly width: number
    readonly height: number
  }
  readonly cell: {
    readonly width: number
    readonly height: number
    readonly baseline?: number
  }
}

export interface RendererResizeRequestEvent {
  readonly rows: number
  readonly columns: number
  readonly reason: 'remote' | 'host-triggered' | 'initial'
}

export type RendererColor = string

export interface RendererTheme {
  readonly background: string
  readonly foreground: string
  readonly cursor: {
    readonly color: string
    readonly opacity?: number
    readonly shape?: 'block' | 'underline' | 'bar'
  }
  readonly selection?: {
    readonly background: string
    readonly foreground?: string
  }
  readonly palette: {
    /**
     * ANSI palette (index 0–15). Consumers should provide at least 16 entries.
     */
    readonly ansi: readonly string[]
    /**
     * Optional 256-colour extension (indices 16–255).
     */
    readonly extended?: readonly string[]
  }
}

export interface CursorOverride {
  readonly visible: boolean
  readonly shape?: 'block' | 'underline' | 'bar'
  readonly blinking?: boolean
  readonly color?: string | null
  readonly opacity?: number
}

export interface RendererHighlight {
  readonly row: number
  readonly startColumn: number
  readonly endColumn: number
  readonly kind: 'search-result' | 'diagnostic' | 'custom'
  readonly color?: string
  readonly metadata?: Record<string, unknown>
}

export interface RendererFrameOverlays {
  readonly selection?: TerminalSelection | null
  readonly cursor?: CursorOverride | null
  readonly highlights?: readonly RendererHighlight[]
  readonly layers?: Record<string, unknown>
}

export interface RendererDirtyRegion {
  readonly rowStart: number
  readonly rowEnd: number
  readonly columnStart: number
  readonly columnEnd: number
}

export interface RendererFontMetrics {
  readonly family: string
  readonly size: number
  readonly letterSpacing: number
  readonly lineHeight: number
}

export interface RendererCellMetrics {
  readonly width: number
  readonly height: number
  readonly baseline: number
}

export interface RendererMetrics {
  readonly devicePixelRatio: number
  readonly font: RendererFontMetrics
  readonly cell: RendererCellMetrics
}

export interface RendererAccessibilityProfile {
  readonly highContrast: boolean
  readonly reducedMotion?: boolean
  readonly colorScheme?: 'light' | 'dark' | 'system'
}

export type TerminalProfile = Partial<{
  theme: RendererTheme
  accessibility: Partial<RendererAccessibilityProfile>
  overlays: Partial<RendererFrameOverlays>
}>

export interface RendererDiagnostics {
  readonly lastFrameDurationMs: number | null
  readonly lastDrawCallCount: number | null
  readonly gpu?: {
    readonly frameDurationMs: number | null
    readonly drawCallCount: number | null
    readonly bytesUploaded: number | null
    readonly dirtyRegionCoverage: number | null
  }
  readonly osc?: { readonly identifier: string; readonly data: string } | null
  readonly sosPmApc?: { readonly kind: string; readonly data: string } | null
  readonly dcs?: {
    readonly finalByte: number
    readonly params: readonly number[]
    readonly intermediates: readonly number[]
    readonly data: string
  } | null
  readonly frameHash?: string
}

export interface RendererFrameEvent<TMetadata = Record<string, unknown>> {
  readonly timestamp: number
  readonly approxFrameDuration: number | null
  readonly dirtyRegion?: { readonly rows: number; readonly columns: number }
  readonly metadata?: TMetadata
  readonly diagnostics?: RendererDiagnostics
  readonly updates?: ReadonlyArray<TerminalUpdate>
  readonly viewport?: { readonly rows: number; readonly columns: number }
}

export type RuntimePointerEventPhase = 'down' | 'move' | 'up' | 'cancel'

export type RendererEvent<_TRendererConfig = unknown> =
  | {
      readonly type: 'runtime.key'
      readonly key: string
      readonly code: string
      readonly alt: boolean
      readonly ctrl: boolean
      readonly meta: boolean
      readonly shift: boolean
    }
  | { readonly type: 'runtime.text'; readonly value: string }
  | {
      readonly type: 'runtime.pointer'
      readonly action: RuntimePointerEventPhase
      readonly pointerId: number
      readonly button: TerminalPointerButton
      readonly buttons: number
      readonly position: { readonly x: number; readonly y: number }
      readonly cell: { readonly row: number; readonly column: number }
      readonly modifiers?: TerminalPointerModifierState
    }
  | {
      readonly type: 'runtime.wheel'
      readonly deltaX: number
      readonly deltaY: number
      readonly cell: { readonly row: number; readonly column: number }
      readonly modifiers?: TerminalPointerModifierState
    }
  | { readonly type: 'runtime.paste'; readonly text: string }
  | {
      readonly type: 'runtime.cursor.set'
      readonly position: CursorPosition
      readonly options?: TerminalRuntimeCursorMoveOptions
    }
  | {
      readonly type: 'runtime.cursor.move'
      readonly direction: TerminalRuntimeCursorMoveDirection
      readonly options?: TerminalRuntimeCursorMoveOptions
    }
  | {
      readonly type: 'runtime.selection.set'
      readonly selection: TerminalSelection
    }
  | {
      readonly type: 'runtime.selection.update'
      readonly selection: TerminalSelection
    }
  | { readonly type: 'runtime.selection.clear' }
  | {
      readonly type: 'runtime.selection.replace'
      readonly replacement: string
      readonly selection?: TerminalSelection | null
      readonly attributesOverride?: TerminalAttributes
    }
  | { readonly type: 'runtime.parser.dispatch'; readonly event: ParserEvent }
  | {
      readonly type: 'runtime.parser.batch'
      readonly events: Iterable<ParserEvent>
    }
  | { readonly type: 'runtime.data'; readonly data: string | Uint8Array }
  | { readonly type: 'runtime.reset' }
  | {
      readonly type: 'renderer.configure'
      readonly configuration: RendererConfiguration
    }
  | { readonly type: 'profile.update'; readonly profile: TerminalProfile }

export type RendererRootContainer = HTMLCanvasElement

export type RendererRootOptions<TRendererConfig = Record<string, unknown>> =
  Readonly<{
    configuration: RendererConfiguration
    profile?: TerminalProfile
    runtime?: TerminalRuntime
  }> &
    Readonly<TRendererConfig>

export interface RendererSession<TRendererConfig = unknown> {
  readonly profile: TerminalProfile
  readonly runtime: TerminalRuntime
  readonly configuration?: RendererConfiguration
  dispatch(event: RendererEvent<TRendererConfig>): void
  onFrame(listener: (event: RendererFrameEvent) => void): () => void
  onResizeRequest?(
    listener: (event: RendererResizeRequestEvent) => void,
  ): () => void
  unmount(): void
  free(): void
  serializeBuffer?(): Promise<ImageBitmap | Uint8Array>
}

export interface RendererRoot<TRendererConfig = unknown> {
  readonly container: RendererRootContainer
  readonly currentSession: RendererSession<TRendererConfig> | null
  mount(): RendererSession<TRendererConfig>
  dispose(): void
}

export interface WebglRendererConfig {
  readonly contextAttributes?: WebGLContextAttributes
  readonly autoFlush?: boolean
  readonly runtime?: TerminalRuntime
  readonly profile?: TerminalProfile
}

export type WebglRendererRootOptions =
  RendererRootOptions<WebglRendererConfig>

export interface WebglRendererFrameMetadata extends Record<string, unknown> {
  readonly reason?:
    | 'initial'
    | 'sync'
    | 'apply-updates'
    | 'manual'
    | 'resize'
    | 'theme-change'
  readonly drawCallCount?: number
  readonly bytesUploaded?: number
  readonly grid?: { readonly rows: number; readonly columns: number }
  readonly cssPixels?: { readonly width: number; readonly height: number }
  readonly framebufferPixels?: {
    readonly width: number
    readonly height: number
  }
}

export interface WebglRendererSession
  extends RendererSession<WebglRendererConfig> {
  readonly serializeBuffer: () => Promise<Uint8Array>
}

export interface RuntimeUpdateBatch {
  readonly snapshot: TerminalState
  readonly updates: readonly TerminalUpdate[]
  readonly reason: 'initial' | 'sync' | 'apply-updates' | 'manual'
}

export type { TerminalRuntimeEvent, TerminalRuntime }
