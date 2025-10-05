import {
  createRendererSession,
  detectPreferredBackend,
  type CanvasRendererDiagnostics,
  type CanvasRendererUpdateOptions,
  type CreateRendererSessionOptions,
  type CursorOverlayStrategy,
  type RendererBackendConfig,
  type RendererBackendFallback,
  type RendererBackendKind,
  type RendererFrameAccessibility,
  type RendererFrameMetadata,
  type RendererFrameOverlays,
  type RendererMetrics,
  type RendererSession,
  type RendererSessionBackend,
  type RendererSessionContextLossEvent,
  type RendererSessionObservers,
  type RendererSessionFrameEvent,
  type RendererTheme,
  type WebglBackendConfig,
  type WebgpuBackendConfig,
} from '@mana/tui-web-canvas-renderer'
import type { TerminalSelection, TerminalState, TerminalUpdate } from '@mana/vt'
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
  readonly customSessionFactory?: (
    options: CreateRendererSessionOptions,
  ) => RendererSession
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
  readonly diagnostics: CanvasRendererDiagnostics | null
  readonly timestamp: number
  readonly backend: TerminalRendererBackendResolved | null
}

export interface TerminalRendererPresentFrameOptions {
  readonly snapshot: TerminalState
  readonly updates?: ReadonlyArray<TerminalUpdate>
  readonly overlays?: RendererFrameOverlays
  readonly accessibility?: RendererFrameAccessibility
  readonly metadata?: RendererFrameMetadata
  readonly reason: TerminalRendererFrameReason
}

const mapSessionBackend = (
  backend: RendererSessionBackend | null,
): TerminalRendererBackendResolved | null => {
  switch (backend) {
    case 'cpu-2d':
      return 'cpu'
    case 'gpu-webgl':
      return 'webgl'
    case 'gpu-webgpu':
      return 'webgpu'
    case 'custom':
      return 'custom'
    default:
      return null
  }
}

const isFrameReason = (value: unknown): value is TerminalRendererFrameReason =>
  value === 'initial-sync' ||
  value === 'apply-updates' ||
  value === 'resize' ||
  value === 'sync' ||
  value === 'theme-change'

const normaliseOverlays = (
  snapshot: TerminalState,
  overlays?: RendererFrameOverlays,
): RendererFrameOverlays => ({
  selection: overlays?.selection ?? snapshot.selection ?? null,
  cursor: overlays?.cursor ?? null,
  highlights: overlays?.highlights,
  layers: overlays?.layers,
})

type ResolvedSessionFactory =
  | {
      kind: 'custom'
      factory: (options: CreateRendererSessionOptions) => RendererSession
    }
  | { kind: RendererBackendKind; config: RendererBackendConfig }

const resolveRendererFactory = (
  canvas: HTMLCanvasElement,
  graphics: TerminalRendererGraphicsOptions,
): ResolvedSessionFactory => {
  if (graphics.customSessionFactory) {
    return { kind: 'custom', factory: graphics.customSessionFactory }
  }

  const fallback = graphics.fallback ?? 'prefer-gpu'
  const backend = graphics.backend ?? 'auto'

  switch (backend) {
    case 'cpu':
      return {
        kind: 'cpu-2d',
        config: { type: 'cpu-2d' } satisfies RendererBackendConfig,
      }
    case 'webgl':
      return {
        kind: 'gpu-webgl',
        config: {
          type: 'gpu-webgl',
          fallback: graphics.webgl?.fallback ?? fallback,
          contextAttributes: graphics.webgl?.contextAttributes,
        },
      }
    case 'webgpu':
      return {
        kind: 'gpu-webgpu',
        config: {
          type: 'gpu-webgpu',
          fallback: graphics.webgpu?.fallback ?? fallback,
          deviceDescriptor: graphics.webgpu?.deviceDescriptor,
          canvasConfiguration: graphics.webgpu?.canvasConfiguration,
        },
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

interface LatestFrameState {
  snapshot: TerminalState
  metrics: RendererMetrics
  theme: RendererTheme
  overlays: RendererFrameOverlays
  accessibility?: RendererFrameAccessibility
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
  readonly overlays?: RendererFrameOverlays
  readonly accessibility?: RendererFrameAccessibility
  readonly onDiagnostics?: (diagnostics: CanvasRendererDiagnostics) => void
  readonly onSelectionChange?: (selection: TerminalSelection | null) => void
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
  readonly onFrame?: (event: TerminalRendererFrameEvent) => void
}

/**
 * Handle returned by {@link useTerminalCanvasRenderer}. Exposes the `<canvas>`
 * ref plus imperative operations, mirroring the renderer session contract.
 */
export interface TerminalRendererHandle {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>
  presentFrame(options: TerminalRendererPresentFrameOptions): void
  /** @deprecated Use {@link presentFrame} instead. */
  readonly applyUpdates: (options: CanvasRendererUpdateOptions) => void
  /** @deprecated Use {@link presentFrame} instead. */
  readonly sync: (snapshot: TerminalState) => void
  readonly dispose: () => void
  readonly diagnostics: CanvasRendererDiagnostics | null
  readonly getCurrentSelection: () => TerminalSelection | null
  readonly backend: TerminalRendererBackendResolved | null
}

/**
 * React hook that bridges the renderer session into React lifecycle. It lazily
 * instantiates the session on first use, replays updates when props change, and
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
    overlays,
    accessibility,
    onDiagnostics,
    onSelectionChange,
    cursorOverlayStrategy,
    onFrame,
  } = options

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<RendererSession | null>(null)
  const diagnosticsRef = useRef<CanvasRendererDiagnostics | null>(null)
  const selectionRef = useRef<TerminalSelection | null>(
    snapshot.selection ?? null,
  )
  const backendRef = useRef<TerminalRendererBackendResolved | null>(null)
  const frameEpochRef = useRef(0)

  const graphicsRef = useRef(graphics)
  const cursorOverlayStrategyRef = useRef<CursorOverlayStrategy | undefined>(
    cursorOverlayStrategy,
  )

  const latestFrameRef = useRef<LatestFrameState>({
    snapshot,
    metrics,
    theme,
    overlays: normaliseOverlays(snapshot, overlays),
    accessibility,
  })

  const selectionCallbackRef = useRef<typeof onSelectionChange>(onSelectionChange)
  const diagnosticsCallbackRef = useRef<typeof onDiagnostics>(onDiagnostics)
  const frameCallbackRef = useRef<typeof onFrame>(onFrame)

  useEffect(() => {
    selectionCallbackRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    diagnosticsCallbackRef.current = onDiagnostics
  }, [onDiagnostics])

  useEffect(() => {
    frameCallbackRef.current = onFrame
  }, [onFrame])

  useEffect(() => {
    graphicsRef.current = graphics
    if (sessionRef.current) {
      sessionRef.current.dispose()
      sessionRef.current = null
      diagnosticsRef.current = null
      backendRef.current = null
      selectionRef.current = null
      frameEpochRef.current = 0
    }
  }, [graphics])

  useEffect(() => {
    cursorOverlayStrategyRef.current = cursorOverlayStrategy
    if (sessionRef.current) {
      sessionRef.current.configure({
        cursorOverlayStrategy,
      })
    }
  }, [cursorOverlayStrategy])

  const handleSessionDiagnostics = useCallback(
    (diagnostics: CanvasRendererDiagnostics) => {
      diagnosticsRef.current = diagnostics
      diagnosticsCallbackRef.current?.(diagnostics)
    },
    [],
  )

  const handleSessionSelectionChange = useCallback(
    (selection: TerminalSelection | null) => {
      selectionRef.current = selection
      selectionCallbackRef.current?.(selection)
    },
    [],
  )

  const handleSessionFrame = useCallback(
    (event: RendererSessionFrameEvent) => {
      backendRef.current = mapSessionBackend(event.backend)
      if (event.diagnostics) {
        diagnosticsRef.current = event.diagnostics
        diagnosticsCallbackRef.current?.(event.diagnostics)
      }
      const reason = event.metadata?.reason
      const resolvedReason = isFrameReason(reason) ? reason : 'sync'
      frameCallbackRef.current?.({
        reason: resolvedReason,
        diagnostics: diagnosticsRef.current,
        timestamp: event.timestamp,
        backend: backendRef.current,
      })
    },
    [],
  )

  const handleSessionContextLost = useCallback(
    (_event: RendererSessionContextLossEvent) => {
      backendRef.current = null
    },
    [],
  )

  const ensureSession = useCallback((): RendererSession => {
    if (sessionRef.current) {
      return sessionRef.current
    }

    const canvas = canvasRef.current
    if (!canvas) {
      throw new Error('Canvas element is not mounted')
    }

    const graphicsOptions = graphicsRef.current
    const resolved = resolveRendererFactory(canvas, graphicsOptions)

    const observers: RendererSessionObservers = {
      onFrame: handleSessionFrame,
      onDiagnostics: handleSessionDiagnostics,
      onContextLost: handleSessionContextLost,
    }

    const baseOptions: CreateRendererSessionOptions = {
      canvas,
      metrics: latestFrameRef.current.metrics,
      theme: latestFrameRef.current.theme,
      backend: resolved.kind === 'custom' ? undefined : resolved.config,
      captureDiagnosticsFrame: graphicsOptions.captureDiagnosticsFrame,
      observers,
      cursorOverlayStrategy: cursorOverlayStrategyRef.current,
      onSelectionChange: handleSessionSelectionChange,
    }

    const session =
      resolved.kind === 'custom'
        ? resolved.factory(baseOptions)
        : createRendererSession(baseOptions)

    sessionRef.current = session
    diagnosticsRef.current = session.getDiagnostics()
    backendRef.current = mapSessionBackend(session.backend)

    return session
  }, [
    handleSessionContextLost,
    handleSessionDiagnostics,
    handleSessionFrame,
    handleSessionSelectionChange,
  ])

  const presentFrame = useCallback(
    (presentOptions: TerminalRendererPresentFrameOptions) => {
      const session = ensureSession()
      const overlaysToUse = presentOptions.overlays
        ? normaliseOverlays(presentOptions.snapshot, presentOptions.overlays)
        : normaliseOverlays(presentOptions.snapshot, {
            ...latestFrameRef.current.overlays,
            selection: presentOptions.snapshot.selection ?? null,
          })
      const accessibilityToUse =
        presentOptions.accessibility ?? latestFrameRef.current.accessibility

      latestFrameRef.current = {
        snapshot: presentOptions.snapshot,
        metrics: latestFrameRef.current.metrics,
        theme: latestFrameRef.current.theme,
        overlays: overlaysToUse,
        accessibility: accessibilityToUse,
      }

      frameEpochRef.current += 1

      const metadata: RendererFrameMetadata = {
        ...(presentOptions.metadata ?? {}),
        reason: presentOptions.reason,
      }

      session.presentFrame({
        snapshot: presentOptions.snapshot,
        updates: presentOptions.updates,
        epoch: frameEpochRef.current,
        viewport: {
          rows: presentOptions.snapshot.rows,
          columns: presentOptions.snapshot.columns,
        },
        metrics: latestFrameRef.current.metrics,
        theme: latestFrameRef.current.theme,
        overlays: overlaysToUse,
        accessibility: accessibilityToUse,
        metadata,
      })

      diagnosticsRef.current = session.getDiagnostics()
      if (diagnosticsRef.current) {
        diagnosticsCallbackRef.current?.(diagnosticsRef.current)
      }
    },
    [ensureSession],
  )

  useEffect(() => {
    latestFrameRef.current = {
      ...latestFrameRef.current,
      snapshot,
      overlays: normaliseOverlays(snapshot, overlays),
    }
  }, [snapshot, overlays])

  useEffect(() => {
    latestFrameRef.current = {
      ...latestFrameRef.current,
      metrics,
    }
    if (sessionRef.current) {
      try {
        sessionRef.current.configure({ metrics })
      } catch {
        /* ignore */
      }
    }
    if (canvasRef.current && frameEpochRef.current > 0) {
      presentFrame({
        snapshot: latestFrameRef.current.snapshot,
        reason: 'resize',
      })
    }
  }, [metrics, presentFrame])

  useEffect(() => {
    latestFrameRef.current = {
      ...latestFrameRef.current,
      theme,
    }
    if (sessionRef.current) {
      try {
        sessionRef.current.configure({ theme })
      } catch {
        /* ignore */
      }
    }
    if (canvasRef.current && frameEpochRef.current > 0) {
      presentFrame({
        snapshot: latestFrameRef.current.snapshot,
        reason: 'theme-change',
      })
    }
  }, [theme, presentFrame])

  useEffect(() => {
    latestFrameRef.current = {
      ...latestFrameRef.current,
      accessibility,
    }
    if (accessibility && canvasRef.current && frameEpochRef.current > 0) {
      presentFrame({
        snapshot: latestFrameRef.current.snapshot,
        reason: 'sync',
        accessibility,
      })
    }
  }, [accessibility, presentFrame])

  useEffect(() => {
    const session = sessionRef.current
    return () => {
      session?.dispose()
      sessionRef.current = null
    }
  }, [])

  const dispose = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.dispose()
    }
    sessionRef.current = null
    diagnosticsRef.current = null
    backendRef.current = null
    selectionRef.current = null
    frameEpochRef.current = 0
  }, [])

  const applyUpdates = useCallback(
    (updateOptions: CanvasRendererUpdateOptions) => {
      presentFrame({
        snapshot: updateOptions.snapshot,
        updates: updateOptions.updates,
        reason: 'apply-updates',
      })
    },
    [presentFrame],
  )

  const sync = useCallback(
    (nextSnapshot: TerminalState) => {
      presentFrame({ snapshot: nextSnapshot, reason: 'sync' })
    },
    [presentFrame],
  )

  return useMemo(
    () => ({
      canvasRef,
      presentFrame,
      applyUpdates,
      sync,
      dispose,
      diagnostics: diagnosticsRef.current,
      getCurrentSelection: () => selectionRef.current,
      backend: backendRef.current,
    }),
    [applyUpdates, dispose, presentFrame, sync],
  )
}
