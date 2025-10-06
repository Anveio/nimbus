import type {
  CursorPosition,
  ParserEvent,
  TerminalAttributes,
  TerminalRuntime,
  TerminalRuntimeCursorMoveDirection,
  TerminalRuntimeCursorMoveOptions,
  TerminalRuntimeHostEvent as TerminalRuntimeEvent,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from '@mana/vt'

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
      readonly phase: RuntimePointerEventPhase
      readonly pointerId: number
      readonly buttons: number
      readonly position: { readonly x: number; readonly y: number }
    }
  | {
      readonly type: 'runtime.wheel'
      readonly deltaX: number
      readonly deltaY: number
    }
  | { readonly type: 'runtime.copy' }
  | { readonly type: 'runtime.paste'; readonly data: string }
  | { readonly type: 'runtime.focus' }
  | { readonly type: 'runtime.blur' }
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

export type RenderSurface<TRendererConfig = { renderRoot: HTMLElement }> =
  | { readonly renderRoot: HTMLElement }
  | {
      readonly renderRoot: TRendererConfig extends { renderRoot: infer T }
        ? T
        : never
    }

export interface RendererInstance<TRendererConfig = unknown> {
  readonly profile: TerminalProfile
  readonly runtime: TerminalRuntime
  readonly configuration?: RendererConfiguration
  mount(surface: RenderSurface<TRendererConfig>): void
  unmount(): void
  dispatch(event: RendererEvent<TRendererConfig>): void
  onFrame(listener: (event: RendererFrameEvent) => void): () => void
  onResizeRequest?(
    listener: (event: RendererResizeRequestEvent) => void,
  ): () => void
  free(): void
  serializeBuffer?(): Promise<ImageBitmap | Uint8Array>
}

export type CreateRendererOptions<TRendererConfig = unknown> = {
  readonly runtime?: TerminalRuntime
  readonly profile?: TerminalProfile
  readonly rendererConfig: RendererConfiguration
} & Partial<TRendererConfig>

export interface WebglRendererConfig {
  readonly contextAttributes?: WebGLContextAttributes
  readonly autoFlush?: boolean
  readonly renderRoot?: HTMLCanvasElement
}

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

export interface WebglRendererInstance
  extends RendererInstance<WebglRendererConfig> {
  readonly serializeBuffer: () => Promise<Uint8Array>
}

export interface RuntimeUpdateBatch {
  readonly snapshot: TerminalState
  readonly updates: readonly TerminalUpdate[]
  readonly reason: 'initial' | 'sync' | 'apply-updates' | 'manual'
}

export type { TerminalRuntimeEvent }
