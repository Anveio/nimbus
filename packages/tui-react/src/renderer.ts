import {
  type CanvasRenderer,
  type CanvasRendererOptions,
  type CanvasRendererResizeOptions,
  type CanvasRendererUpdateOptions,
  type CreateCanvasRenderer,
  type CursorOverlayStrategy,
  createCanvasRenderer as createDefaultCanvasRenderer,
  type RendererMetrics,
  type RendererTheme,
} from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalSelection, TerminalState } from '@mana-ssh/vt'
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'

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
  readonly onSelectionChange?: (selection: TerminalSelection | null) => void
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
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
  readonly getCurrentSelection: () => TerminalSelection | null
}

/**
 * React hook that bridges the canvas renderer into React lifecycle. It lazily
 * instantiates the renderer on first use, replays updates when props change, and
 * emits diagnostics after every operation.
 */
export const useTerminalCanvasRenderer = (
  options: UseTerminalRendererOptions,
): TerminalRendererHandle => {
  const {
    renderer,
    metrics,
    theme,
    snapshot,
    onDiagnostics,
    onSelectionChange,
    cursorOverlayStrategy,
  } = options
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const diagnosticsRef = useRef<CanvasRenderer['diagnostics'] | null>(null)
  const selectionRef = useRef<TerminalSelection | null>(
    snapshot.selection ?? null,
  )
  const rendererFactoryRef = useRef<CreateCanvasRenderer | undefined>(renderer)
  const latestOptionsRef = useRef({
    metrics,
    theme,
    snapshot,
    cursorOverlayStrategy,
  })
  const selectionCallbackRef =
    useRef<typeof onSelectionChange>(onSelectionChange)

  useEffect(() => {
    rendererFactoryRef.current = renderer
    if (rendererRef.current) {
      rendererRef.current.dispose()
      rendererRef.current = null
      diagnosticsRef.current = null
    }
  }, [renderer])

  useEffect(() => {
    latestOptionsRef.current = {
      metrics,
      theme,
      snapshot,
      cursorOverlayStrategy,
    }
  }, [metrics, theme, snapshot, cursorOverlayStrategy])

  useEffect(() => {
    selectionCallbackRef.current = onSelectionChange
    if (onSelectionChange && rendererRef.current) {
      onSelectionChange(rendererRef.current.currentSelection)
    }
  }, [onSelectionChange])

  const ensureRenderer = useCallback(() => {
    if (rendererRef.current) {
      return rendererRef.current
    }

    const canvas = canvasRef.current
    if (!canvas) {
      throw new Error('Canvas element is not mounted')
    }

    const factory = rendererFactoryRef.current ?? createDefaultCanvasRenderer
    const {
      metrics: currentMetrics,
      theme: currentTheme,
      snapshot: currentSnapshot,
      cursorOverlayStrategy: currentCursorOverlayStrategy,
    } = latestOptionsRef.current

    const instance = factory({
      canvas,
      metrics: currentMetrics,
      theme: currentTheme,
      snapshot: currentSnapshot,
      cursorOverlayStrategy: currentCursorOverlayStrategy,
      onSelectionChange: (selection) => {
        selectionRef.current = selection
        selectionCallbackRef.current?.(selection)
      },
    } satisfies CanvasRendererOptions)

    rendererRef.current = instance
    diagnosticsRef.current = instance.diagnostics
    selectionRef.current = instance.currentSelection
    selectionCallbackRef.current?.(instance.currentSelection)
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
      selectionRef.current = rendererInstance.currentSelection
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  useEffect(() => {
    if (!rendererRef.current) {
      return
    }
    rendererRef.current.dispose()
    rendererRef.current = null
    diagnosticsRef.current = null
    selectionRef.current = null

    if (canvasRef.current) {
      const rendererInstance = ensureRenderer()
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      onDiagnostics?.(rendererInstance.diagnostics)
    }
  }, [cursorOverlayStrategy, ensureRenderer, onDiagnostics])

  const resize = useCallback(
    (resizeOptions: CanvasRendererResizeOptions) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.resize(resizeOptions)
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const setTheme = useCallback(
    (nextTheme: RendererTheme) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.setTheme(nextTheme)
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const sync = useCallback(
    (nextSnapshot: TerminalState) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.sync(nextSnapshot)
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      onDiagnostics?.(rendererInstance.diagnostics)
    },
    [ensureRenderer, onDiagnostics],
  )

  const dispose = useCallback(() => {
    rendererRef.current?.dispose()
    rendererRef.current = null
    diagnosticsRef.current = null
    selectionRef.current = null
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
      getCurrentSelection: () => selectionRef.current,
    }),
    [applyUpdates, dispose, resize, setTheme, sync],
  )
}
