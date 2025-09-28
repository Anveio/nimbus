import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  createCanvasRenderer as createDefaultCanvasRenderer,
  type CanvasRenderer,
  type CanvasRendererOptions,
  type CanvasRendererResizeOptions,
  type CanvasRendererUpdateOptions,
  type CreateCanvasRenderer,
  type RendererMetrics,
  type RendererTheme,
} from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalState } from '@mana-ssh/vt'

/**
 * Options accepted by {@link useTerminalCanvasRenderer}. Consumers provide the
 * terminal snapshot/metrics/theme and may override the renderer factory (useful
 * for custom backends or tests).
 */
export interface UseTerminalRendererOptions {
  readonly renderer?: CreateCanvasRenderer
  readonly theme: RendererTheme
  readonly metrics: RendererMetrics
  readonly snapshot: TerminalState
  readonly onDiagnostics?: (diagnostics: CanvasRenderer['diagnostics']) => void
}

/**
 * Handle returned by {@link useTerminalCanvasRenderer}. Exposes the `<canvas>`
 * ref plus imperative operations, mirroring the `CanvasRenderer` contract.
 */
export interface TerminalRendererHandle {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>
  readonly applyUpdates: (options: CanvasRendererUpdateOptions) => void
  readonly resize: (options: CanvasRendererResizeOptions) => void
  readonly setTheme: (theme: RendererTheme) => void
  readonly sync: (snapshot: TerminalState) => void
  readonly dispose: () => void
  readonly diagnostics: CanvasRenderer['diagnostics'] | null
}

/**
 * React hook that bridges the canvas renderer into React lifecycle. It lazily
 * instantiates the renderer on first use, replays updates when props change, and
 * emits diagnostics after every operation.
 */
export const useTerminalCanvasRenderer = (
  options: UseTerminalRendererOptions,
): TerminalRendererHandle => {
  const { renderer, metrics, theme, snapshot, onDiagnostics } = options
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const diagnosticsRef = useRef<CanvasRenderer['diagnostics'] | null>(null)
  const rendererFactoryRef = useRef<CreateCanvasRenderer | undefined>(renderer)
  const latestOptionsRef = useRef({ metrics, theme, snapshot })

  useEffect(() => {
    rendererFactoryRef.current = renderer
    if (rendererRef.current) {
      rendererRef.current.dispose()
      rendererRef.current = null
      diagnosticsRef.current = null
    }
  }, [renderer])

  useEffect(() => {
    latestOptionsRef.current = { metrics, theme, snapshot }
  }, [metrics, theme, snapshot])

  const ensureRenderer = useCallback(() => {
    if (rendererRef.current) {
      return rendererRef.current
    }

    const canvas = canvasRef.current
    if (!canvas) {
      throw new Error('Canvas element is not mounted')
    }

    const factory = rendererFactoryRef.current ?? createDefaultCanvasRenderer
    const { metrics: currentMetrics, theme: currentTheme, snapshot: currentSnapshot } =
      latestOptionsRef.current

    const instance = factory({
      canvas,
      metrics: currentMetrics,
      theme: currentTheme,
      snapshot: currentSnapshot,
    } satisfies CanvasRendererOptions)

    rendererRef.current = instance
    diagnosticsRef.current = instance.diagnostics
    onDiagnostics?.(instance.diagnostics)
    return instance
  }, [onDiagnostics])

  useEffect(() => {
    const rendererInstance = ensureRenderer()
    return () => {
      rendererInstance.dispose()
      rendererRef.current = null
      diagnosticsRef.current = null
    }
  }, [ensureRenderer])

  useEffect(() => {
    const rendererInstance = ensureRenderer()
    rendererInstance.setTheme(theme)
    diagnosticsRef.current = rendererInstance.diagnostics
    onDiagnostics?.(rendererInstance.diagnostics)
  }, [ensureRenderer, theme, onDiagnostics])

  useEffect(() => {
    const rendererInstance = ensureRenderer()
    rendererInstance.resize({ metrics, snapshot })
    rendererInstance.sync(snapshot)
    diagnosticsRef.current = rendererInstance.diagnostics
    onDiagnostics?.(rendererInstance.diagnostics)
  }, [ensureRenderer, metrics, snapshot, onDiagnostics])

  const applyUpdates = useCallback(
    (updateOptions: CanvasRendererUpdateOptions) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.applyUpdates(updateOptions)
      diagnosticsRef.current = rendererInstance.diagnostics
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const resize = useCallback(
    (resizeOptions: CanvasRendererResizeOptions) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.resize(resizeOptions)
      diagnosticsRef.current = rendererInstance.diagnostics
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const setTheme = useCallback(
    (nextTheme: RendererTheme) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.setTheme(nextTheme)
      diagnosticsRef.current = rendererInstance.diagnostics
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const sync = useCallback(
    (nextSnapshot: TerminalState) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.sync(nextSnapshot)
      diagnosticsRef.current = rendererInstance.diagnostics
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const dispose = useCallback(() => {
    rendererRef.current?.dispose()
    rendererRef.current = null
    diagnosticsRef.current = null
  }, [])

  return useMemo(
    () => ({
      canvasRef,
      applyUpdates,
      resize,
      setTheme,
      sync,
      dispose,
      diagnostics: diagnosticsRef.current,
    }),
    [applyUpdates, dispose, resize, setTheme, sync],
  )
}
