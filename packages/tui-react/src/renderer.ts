import {
  type CanvasRenderer,
  type CanvasRendererOptions,
  type CanvasRendererUpdateOptions,
  type CreateCanvasRenderer,
  type CursorOverlayStrategy,
  createCanvasRenderer as createDefaultCanvasRenderer,
  detectPreferredBackend,
  type RendererBackendConfig,
  type RendererBackendFallback,
  type RendererBackendKind,
  type RendererMetrics,
  type RendererTheme,
  type WebglBackendConfig,
  type WebgpuBackendConfig,
} from '@mana/tui-web-canvas-renderer'
import type { TerminalSelection, TerminalState } from '@mana/vt'
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'

export type TerminalRendererBackendChoice = 'auto' | 'cpu' | 'webgl' | 'webgpu'

export type TerminalRendererBackendResolved =
  | 'custom'
  | 'cpu'
  | 'webgl'
  | 'webgpu'

export interface TerminalRendererGraphicsOptions {
  readonly backend?: TerminalRendererBackendChoice
  readonly fallback?: RendererBackendFallback
  readonly webgl?: Omit<WebglBackendConfig, 'type'>
  readonly webgpu?: Omit<WebgpuBackendConfig, 'type'>
  readonly customFactory?: CreateCanvasRenderer
  readonly captureDiagnosticsFrame?: boolean
}

export type TerminalRendererFrameReason =
  | 'initial-sync'
  | 'apply-updates'
  | 'resize'
  | 'sync'
  | 'theme-change'

export interface TerminalRendererFrameEvent {
  readonly reason: TerminalRendererFrameReason
  readonly diagnostics: CanvasRenderer['diagnostics']
  readonly timestamp: number
  readonly backend: TerminalRendererBackendResolved | null
}

const mapRendererBackendKind = (
  backend: RendererBackendKind,
): TerminalRendererBackendResolved => {
  switch (backend) {
    case 'cpu-2d':
      return 'cpu'
    case 'gpu-webgl':
      return 'webgl'
    case 'gpu-webgpu':
      return 'webgpu'
    default:
      return 'custom'
  }
}

const resolveTimestamp = (): number => {
  if (
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
  ) {
    return performance.now()
  }
  return Date.now()
}

const setCanvasBackendDataset = (
  canvas: CanvasRenderer['canvas'],
  backend: TerminalRendererBackendResolved | null,
): void => {
  if (!canvas) {
    return
  }
  const element = canvas as HTMLCanvasElement
  if (!element || typeof element !== 'object') {
    return
  }
  if ('dataset' in element && element.dataset) {
    if (backend) {
      element.dataset.manaRendererBackend = backend
    } else {
      delete element.dataset.manaRendererBackend
    }
  }
}

type ResolvedRendererFactory =
  | { kind: 'custom'; factory: CreateCanvasRenderer }
  | { kind: RendererBackendKind; config: RendererBackendConfig }

const resolveRendererFactory = (
  canvas: HTMLCanvasElement,
  graphics: TerminalRendererGraphicsOptions,
): ResolvedRendererFactory => {
  if (graphics.customFactory) {
    return { kind: 'custom', factory: graphics.customFactory }
  }

  const fallback = graphics.fallback ?? 'prefer-gpu'
  const backend = graphics.backend ?? 'auto'

  switch (backend) {
    case 'cpu':
      return {
        kind: 'cpu-2d',
        config: { type: 'cpu-2d' } satisfies RendererBackendConfig,
      }
    case 'webgl': {
      const config: RendererBackendConfig = {
        type: 'gpu-webgl',
        fallback: graphics.webgl?.fallback ?? fallback,
        contextAttributes: graphics.webgl?.contextAttributes,
      }
      return { kind: 'gpu-webgl', config }
    }
    case 'webgpu': {
      const config: RendererBackendConfig = {
        type: 'gpu-webgpu',
        fallback: graphics.webgpu?.fallback ?? fallback,
        deviceDescriptor: graphics.webgpu?.deviceDescriptor,
        canvasConfiguration: graphics.webgpu?.canvasConfiguration,
      }
      return { kind: 'gpu-webgpu', config }
    }
    default: {
      const detected = detectPreferredBackend({
        canvas,
        fallback,
        webgl: graphics.webgl
          ? { contextAttributes: graphics.webgl.contextAttributes }
          : undefined,
        webgpu: graphics.webgpu
          ? {
              deviceDescriptor: graphics.webgpu.deviceDescriptor,
              canvasConfiguration: graphics.webgpu.canvasConfiguration,
            }
          : undefined,
      })
      return { kind: detected.type, config: detected }
    }
  }
}

/**
 * Options accepted by {@link useTerminalCanvasRenderer}. Consumers provide the
 * terminal snapshot/metrics/theme and may override the renderer factory (useful
 * for custom backends or tests).
 */
export interface UseTerminalRendererOptions {
  readonly graphics: TerminalRendererGraphicsOptions
  readonly theme: RendererTheme
  readonly metrics: RendererMetrics
  readonly snapshot: TerminalState
  readonly onDiagnostics?: (diagnostics: CanvasRenderer['diagnostics']) => void
  readonly onSelectionChange?: (selection: TerminalSelection | null) => void
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
  readonly onFrame?: (event: TerminalRendererFrameEvent) => void
}

/**
 * Handle returned by {@link useTerminalCanvasRenderer}. Exposes the `<canvas>`
 * ref plus imperative operations, mirroring the `CanvasRenderer` contract.
 */
export interface TerminalRendererHandle {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>
  readonly applyUpdates: (options: CanvasRendererUpdateOptions) => void
  readonly sync: (snapshot: TerminalState) => void
  readonly dispose: () => void
  readonly diagnostics: CanvasRenderer['diagnostics'] | null
  readonly getCurrentSelection: () => TerminalSelection | null
  readonly backend: TerminalRendererBackendResolved | null
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
    graphics,
    metrics,
    theme,
    snapshot,
    onDiagnostics,
    onSelectionChange,
    cursorOverlayStrategy,
    onFrame,
  } = options

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const diagnosticsRef = useRef<CanvasRenderer['diagnostics'] | null>(null)
  const selectionRef = useRef<TerminalSelection | null>(
    snapshot.selection ?? null,
  )
  const backendRef = useRef<TerminalRendererBackendResolved | null>(null)
  const graphicsRef = useRef<TerminalRendererGraphicsOptions>(graphics)
  const latestOptionsRef = useRef({
    metrics,
    theme,
    snapshot,
    cursorOverlayStrategy,
  })
  const selectionCallbackRef =
    useRef<typeof onSelectionChange>(onSelectionChange)
  const diagnosticsCallbackRef = useRef<typeof onDiagnostics>(onDiagnostics)
  const frameCallbackRef = useRef<typeof onFrame>(onFrame)

  useEffect(() => {
    graphicsRef.current = graphics
    if (rendererRef.current) {
      rendererRef.current.dispose()
      rendererRef.current = null
      diagnosticsRef.current = null
      backendRef.current = null
      if (canvasRef.current) {
        setCanvasBackendDataset(canvasRef.current, null)
      }
    }
  }, [graphics])

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

  useEffect(() => {
    diagnosticsCallbackRef.current = onDiagnostics
    if (onDiagnostics && diagnosticsRef.current) {
      onDiagnostics(diagnosticsRef.current)
    }
  }, [onDiagnostics])

  useEffect(() => {
    frameCallbackRef.current = onFrame
  }, [onFrame])

  const emitFrame = useCallback((reason: TerminalRendererFrameReason) => {
    const callback = frameCallbackRef.current
    const instance = rendererRef.current
    if (!callback || !instance) {
      return
    }
    callback({
      reason,
      diagnostics: instance.diagnostics,
      timestamp: resolveTimestamp(),
      backend: backendRef.current,
    })
  }, [])

  const ensureRenderer = useCallback(() => {
    if (rendererRef.current) {
      return rendererRef.current
    }

    const canvas = canvasRef.current
    if (!canvas) {
      throw new Error('Canvas element is not mounted')
    }

    const {
      metrics: currentMetrics,
      theme: currentTheme,
      snapshot: currentSnapshot,
      cursorOverlayStrategy: currentCursorOverlayStrategy,
    } = latestOptionsRef.current

    const graphicsOptions = graphicsRef.current
    const resolved = resolveRendererFactory(canvas, graphicsOptions)

    const instance = (() => {
      const baseOptions: CanvasRendererOptions = {
        canvas,
        metrics: currentMetrics,
        theme: currentTheme,
        snapshot: currentSnapshot,
        cursorOverlayStrategy: currentCursorOverlayStrategy,
        captureDiagnosticsFrame: graphicsOptions.captureDiagnosticsFrame,
        onSelectionChange: (selection) => {
          selectionRef.current = selection
          selectionCallbackRef.current?.(selection)
        },
      }

      if (resolved.kind === 'custom') {
        backendRef.current = 'custom'
        return resolved.factory(baseOptions)
      }

      const renderer = createDefaultCanvasRenderer({
        ...baseOptions,
        backend: resolved.config,
      })
      backendRef.current = mapRendererBackendKind(resolved.kind)
      return renderer
    })()

    setCanvasBackendDataset(canvas, backendRef.current)

    rendererRef.current = instance
    diagnosticsRef.current = instance.diagnostics
    selectionRef.current = instance.currentSelection
    selectionCallbackRef.current?.(instance.currentSelection)
    diagnosticsCallbackRef.current?.(instance.diagnostics)
    emitFrame('initial-sync')
    return instance
  }, [emitFrame])

  useEffect(() => {
    const rendererInstance = ensureRenderer()
    return () => {
      rendererInstance.dispose()
      rendererRef.current = null
      diagnosticsRef.current = null
      selectionRef.current = null
      backendRef.current = null
      if (canvasRef.current) {
        setCanvasBackendDataset(canvasRef.current, null)
      }
    }
  }, [ensureRenderer])

  useEffect(() => {
    const rendererInstance = ensureRenderer()
    rendererInstance.applyUpdates({ snapshot, theme })
    diagnosticsRef.current = rendererInstance.diagnostics
    selectionRef.current = rendererInstance.currentSelection
    diagnosticsCallbackRef.current?.(rendererInstance.diagnostics)
    emitFrame('theme-change')
  }, [ensureRenderer, snapshot, theme, emitFrame])

  useEffect(() => {
    const rendererInstance = ensureRenderer()
    rendererInstance.applyUpdates({ snapshot, metrics })
    diagnosticsRef.current = rendererInstance.diagnostics
    selectionRef.current = rendererInstance.currentSelection
    diagnosticsCallbackRef.current?.(rendererInstance.diagnostics)
    emitFrame('resize')
  }, [ensureRenderer, metrics, snapshot, emitFrame])

  const applyUpdates = useCallback(
    (updateOptions: CanvasRendererUpdateOptions) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.applyUpdates(updateOptions)
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      diagnosticsCallbackRef.current?.(rendererInstance.diagnostics)
      emitFrame('apply-updates')
    },
    [ensureRenderer, emitFrame],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderer disposal must react to strategy even though refs carry state
  useEffect(() => {
    if (!rendererRef.current) {
      return
    }
    rendererRef.current.dispose()
    rendererRef.current = null
    diagnosticsRef.current = null
    selectionRef.current = null
    backendRef.current = null

    if (canvasRef.current) {
      const rendererInstance = ensureRenderer()
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      diagnosticsCallbackRef.current?.(rendererInstance.diagnostics)
      emitFrame('initial-sync')
    }
  }, [cursorOverlayStrategy, ensureRenderer, emitFrame])

  const sync = useCallback(
    (nextSnapshot: TerminalState) => {
      const rendererInstance = ensureRenderer()
      rendererInstance.sync(nextSnapshot)
      diagnosticsRef.current = rendererInstance.diagnostics
      selectionRef.current = rendererInstance.currentSelection
      diagnosticsCallbackRef.current?.(rendererInstance.diagnostics)
      emitFrame('sync')
    },
    [ensureRenderer, emitFrame],
  )

  const dispose = useCallback(() => {
    if (rendererRef.current) {
      rendererRef.current.dispose()
    }
    rendererRef.current = null
    diagnosticsRef.current = null
    selectionRef.current = null
    backendRef.current = null
    if (canvasRef.current) {
      setCanvasBackendDataset(canvasRef.current, null)
    }
  }, [])

  return useMemo(
    () => ({
      canvasRef,
      applyUpdates,
      sync,
      dispose,
      diagnostics: diagnosticsRef.current,
      getCurrentSelection: () => selectionRef.current,
      backend: backendRef.current,
    }),
    [applyUpdates, dispose, sync],
  )
}
