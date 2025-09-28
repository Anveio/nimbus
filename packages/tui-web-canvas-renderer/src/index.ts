import type { TerminalState, TerminalUpdate } from '@mana-ssh/vt'

/**
 * Minimal surface that covers `HTMLCanvasElement`, `OffscreenCanvas`, and
 * node-canvas' `Canvas` implementation. Structural typing keeps the renderer
 * decoupled from any specific DOM lib while remaining easy to satisfy in tests.
 */
export interface CanvasLike {
  width: number
  height: number
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D | null
}

/**
 * CSS-compatible colour representation. Implementations are expected to accept
 * anything that works with `CanvasRenderingContext2D#fillStyle`.
 */
export type RendererColor = string

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
  /** Font family string used when configuring the 2D context. */
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

export interface CanvasRendererOptions {
  readonly canvas: CanvasLike
  readonly metrics: RendererMetrics
  readonly theme: RendererTheme
  /**
   * Initial interpreter snapshot used to paint the full screen buffer.
   */
  readonly snapshot: TerminalState
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
}

export interface CanvasRenderer {
  readonly canvas: CanvasLike
  applyUpdates(options: CanvasRendererUpdateOptions): void
  resize(options: CanvasRendererResizeOptions): void
  setTheme(theme: RendererTheme): void
  /** Resynchronise the canvas with the entire snapshot (full repaint). */
  sync(snapshot: TerminalState): void
  dispose(): void
  readonly diagnostics: CanvasRendererDiagnostics
}

export type CreateCanvasRenderer = (
  options: CanvasRendererOptions,
) => CanvasRenderer
