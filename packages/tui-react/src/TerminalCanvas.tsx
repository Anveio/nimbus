import {
  forwardRef,
  type CSSProperties,
  type ForwardedRef,
  type RefAttributes,
  type HTMLAttributes,
  useImperativeHandle,
} from 'react'
import type {
  CanvasRendererResizeOptions,
  CanvasRendererUpdateOptions,
  CreateCanvasRenderer,
  RendererMetrics,
  RendererTheme,
} from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalState } from '@mana-ssh/vt'
import { useTerminalCanvasRenderer, type TerminalRendererHandle } from './renderer'

export interface TerminalCanvasHandle {
  applyUpdates(options: CanvasRendererUpdateOptions): void
  resize(options: CanvasRendererResizeOptions): void
  setTheme(theme: RendererTheme): void
  sync(snapshot: TerminalState): void
  dispose(): void
}

export interface TerminalCanvasProps
  extends Omit<HTMLAttributes<HTMLCanvasElement>, 'children' | 'ref'> {
  readonly renderer?: CreateCanvasRenderer
  readonly metrics: RendererMetrics
  readonly theme: RendererTheme
  readonly snapshot: TerminalState
  readonly onDiagnostics?: (diagnostics: TerminalRendererHandle['diagnostics']) => void
}

const TerminalCanvasComponent = (
  props: TerminalCanvasProps,
  ref: ForwardedRef<TerminalCanvasHandle>,
) => {
  const { renderer, metrics, theme, snapshot, onDiagnostics, style, className, ...rest } = props
  const handle = useTerminalCanvasRenderer({
    renderer,
    metrics,
    theme,
    snapshot,
    onDiagnostics,
  })

  useImperativeHandle(ref, () => ({
    applyUpdates: handle.applyUpdates,
    dispose: handle.dispose,
    resize: handle.resize,
    setTheme: handle.setTheme,
    sync: handle.sync,
  }))

  const canvasStyle: CSSProperties | undefined = style

  return <canvas ref={handle.canvasRef} className={className} style={canvasStyle} {...rest} />
}

export const TerminalCanvas = forwardRef<TerminalCanvasHandle, TerminalCanvasProps>(
  TerminalCanvasComponent,
)
