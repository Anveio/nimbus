import type {
  CursorOverlayStrategy,
  RendererBackendFallback,
  RendererCellMetrics,
  RendererCursorTheme,
  RendererFontMetrics,
  RendererMetrics,
  RendererPalette,
  RendererSelectionTheme,
  RendererTheme,
  WebglBackendConfig,
  WebgpuBackendConfig,
} from '@mana/tui-web-canvas-renderer'
import type { CSSProperties, ReactNode } from 'react'
import type { ShortcutGuideConfig } from '../accessibility/accessibility-layer'
import type { TerminalRendererGraphicsOptions } from '../renderer'

export type TerminalGraphicsBackend = 'cpu' | 'webgl' | 'webgpu'

export interface TerminalAccessibilityOptions {
  readonly ariaLabel?: string
  readonly instructions?: ReactNode
  readonly shortcutGuide?: ShortcutGuideConfig | false
  readonly autoFocus?: boolean
}

export interface TerminalStylingOptions {
  readonly rows?: number
  readonly columns?: number
  readonly autoResize?: boolean
  readonly localEcho?: boolean
  readonly theme?: Partial<RendererTheme>
  readonly metrics?: {
    readonly devicePixelRatio?: number
    readonly font?: Partial<RendererFontMetrics>
    readonly cell?: Partial<RendererCellMetrics>
  }
  readonly canvas?: {
    readonly className?: string
    readonly style?: CSSProperties
  }
}

export interface TerminalGraphicsOptions {
  readonly backend?: TerminalGraphicsBackend
  readonly fallback?: RendererBackendFallback
  readonly webgl?: Omit<WebglBackendConfig, 'type'>
  readonly webgpu?: Omit<WebgpuBackendConfig, 'type'>
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
  readonly captureDiagnosticsFrame?: boolean
}

const DEFAULT_THEME: RendererTheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: { color: '#58a6ff', opacity: 1, shape: 'block' },
  selection: { background: '#264f78', foreground: '#ffffff' },
  palette: {
    ansi: [
      '#000000',
      '#ff5555',
      '#50fa7b',
      '#f1fa8c',
      '#bd93f9',
      '#ff79c6',
      '#8be9fd',
      '#bbbbbb',
      '#44475a',
      '#ff6e6e',
      '#69ff94',
      '#ffffa5',
      '#d6acff',
      '#ff92df',
      '#a4ffff',
      '#ffffff',
    ],
  },
}

const DEFAULT_FONT: RendererFontMetrics = {
  family: `'Fira Code', Menlo, monospace`,
  size: 14,
  letterSpacing: 0,
  lineHeight: 1.2,
}

const DEFAULT_CELL: RendererCellMetrics = {
  width: 9,
  height: 18,
  baseline: 14,
}

const DEFAULT_METRICS: RendererMetrics = {
  devicePixelRatio:
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1,
  font: DEFAULT_FONT,
  cell: DEFAULT_CELL,
}

const mergeCursorTheme = (
  base: RendererCursorTheme,
  override?: Partial<RendererCursorTheme>,
): RendererCursorTheme => ({
  color: override?.color ?? base.color,
  opacity: override?.opacity ?? base.opacity,
  shape: override?.shape ?? base.shape,
})

const mergePalette = (
  base: RendererPalette,
  override?: Partial<RendererPalette>,
): RendererPalette => ({
  ansi: override?.ansi ?? base.ansi,
  extended: override?.extended ?? base.extended,
})

const mergeSelectionTheme = (
  base: RendererSelectionTheme | undefined,
  override?: RendererSelectionTheme,
): RendererSelectionTheme | undefined => {
  if (!base && !override) {
    return undefined
  }
  const resolvedBackground = override?.background ?? base?.background
  const resolvedForeground =
    override && Object.hasOwn(override, 'foreground')
      ? override.foreground
      : base?.foreground

  if (!resolvedBackground) {
    return undefined
  }

  if (resolvedForeground !== undefined) {
    return {
      background: resolvedBackground,
      foreground: resolvedForeground,
    }
  }

  return {
    background: resolvedBackground,
  }
}

const mergeTheme = (override?: Partial<RendererTheme>): RendererTheme => ({
  background: override?.background ?? DEFAULT_THEME.background,
  foreground: override?.foreground ?? DEFAULT_THEME.foreground,
  cursor: mergeCursorTheme(DEFAULT_THEME.cursor, override?.cursor),
  selection: mergeSelectionTheme(DEFAULT_THEME.selection, override?.selection),
  palette: mergePalette(DEFAULT_THEME.palette, override?.palette),
})

const mergeFont = (
  override?: Partial<RendererFontMetrics>,
): RendererFontMetrics => ({
  family: override?.family ?? DEFAULT_FONT.family,
  size: override?.size ?? DEFAULT_FONT.size,
  letterSpacing: override?.letterSpacing ?? DEFAULT_FONT.letterSpacing,
  lineHeight: override?.lineHeight ?? DEFAULT_FONT.lineHeight,
})

const mergeCell = (
  override?: Partial<RendererCellMetrics>,
): RendererCellMetrics => ({
  width: override?.width ?? DEFAULT_CELL.width,
  height: override?.height ?? DEFAULT_CELL.height,
  baseline: override?.baseline ?? DEFAULT_CELL.baseline,
})

const mergeMetrics = (override?: {
  readonly devicePixelRatio?: number
  readonly font?: Partial<RendererFontMetrics>
  readonly cell?: Partial<RendererCellMetrics>
}): RendererMetrics => ({
  devicePixelRatio:
    override?.devicePixelRatio ?? DEFAULT_METRICS.devicePixelRatio,
  font: mergeFont(override?.font),
  cell: mergeCell(override?.cell),
})

export interface ResolvedAccessibilityOptions {
  readonly ariaLabel: string
  readonly instructions: ReactNode | null
  readonly shortcutGuide: ShortcutGuideConfig | false
  readonly autoFocus: boolean
}

export const resolveAccessibilityOptions = (
  options: TerminalAccessibilityOptions | null | undefined,
): ResolvedAccessibilityOptions => ({
  ariaLabel: options?.ariaLabel ?? 'Terminal',
  instructions: options?.instructions ?? null,
  shortcutGuide: options?.shortcutGuide ?? {},
  autoFocus: options?.autoFocus ?? false,
})

export interface ResolvedStylingOptions {
  readonly rows: number | undefined
  readonly columns: number | undefined
  readonly autoResize: boolean
  readonly localEcho: boolean
  readonly theme: RendererTheme
  readonly metrics: RendererMetrics
  readonly canvasClassName?: string
  readonly canvasStyle?: CSSProperties
}

export const resolveStylingOptions = (
  options: TerminalStylingOptions | null | undefined,
): ResolvedStylingOptions => ({
  rows: options?.rows,
  columns: options?.columns,
  autoResize: options?.autoResize ?? true,
  localEcho: options?.localEcho ?? true,
  theme: mergeTheme(options?.theme),
  metrics: mergeMetrics(options?.metrics),
  canvasClassName: options?.canvas?.className,
  canvasStyle: options?.canvas?.style,
})

export interface ResolvedGraphicsOptions {
  readonly renderer: TerminalRendererGraphicsOptions
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
}

export const resolveGraphicsOptions = (
  options: TerminalGraphicsOptions | null | undefined,
): ResolvedGraphicsOptions => ({
  renderer: {
    backend: options?.backend ?? 'auto',
    fallback: options?.fallback,
    webgl: options?.webgl,
    webgpu: options?.webgpu,
    captureDiagnosticsFrame: options?.captureDiagnosticsFrame,
  },
  cursorOverlayStrategy: options?.cursorOverlayStrategy,
})

export {
  DEFAULT_THEME,
  DEFAULT_METRICS,
  DEFAULT_FONT,
  DEFAULT_CELL,
}
