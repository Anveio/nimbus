import {
  createRenderer,
  type CreateRendererOptions,
  type RendererConfiguration,
  type RendererEvent,
  type RendererFrameEvent,
  type RendererInstance,
  type RendererResizeRequestEvent,
  type TerminalProfile,
} from '@mana/webgl-renderer'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type RendererSessionStatus = 'idle' | 'loading' | 'ready' | 'error'

interface UseRendererSessionErrorContext {
  readonly phase:
    | 'create'
    | 'mount'
    | 'dispatch'
    | 'configure'
    | 'profile'
    | 'unmount'
  readonly meta?: Record<string, unknown>
}

export interface UseRendererSessionOptions<TRendererConfig = unknown> {
  readonly configuration: RendererConfiguration
  readonly profile: TerminalProfile
  readonly factoryOptions?: Partial<
    Omit<CreateRendererOptions<TRendererConfig>, 'rendererConfig'>
  >
  readonly factory?: (
    options: CreateRendererOptions<TRendererConfig>,
  ) => Promise<RendererInstance<TRendererConfig>> | RendererInstance<TRendererConfig>
  readonly creationKey?: string
  readonly onFrame?: (event: RendererFrameEvent<TRendererConfig>) => void
  readonly onResizeRequest?: (
    event: RendererResizeRequestEvent,
  ) => void
  readonly onError?: (error: Error, context: UseRendererSessionErrorContext) => void
}

export interface RendererSessionHandle<TRendererConfig = unknown> {
  readonly status: RendererSessionStatus
  readonly renderer: RendererInstance<TRendererConfig> | null
  readonly canvasRef: (element: HTMLCanvasElement | null) => void
  readonly dispatch: (event: RendererEvent<TRendererConfig>) => void
  readonly snapshot: RendererInstance<TRendererConfig>['runtime']['snapshot'] | null
  readonly snapshotVersion: number
  readonly diagnostics: RendererFrameEvent<TRendererConfig>['diagnostics'] | null
  readonly lastFrame: RendererFrameEvent<TRendererConfig> | null
  readonly error: Error | null
}

export const useRendererSession = <TRendererConfig = unknown>(
  options: UseRendererSessionOptions<TRendererConfig>,
): RendererSessionHandle<TRendererConfig> => {
  const {
    configuration,
    profile,
    factoryOptions,
    factory = createRenderer as (
      opts: CreateRendererOptions<TRendererConfig>,
    ) => Promise<RendererInstance<TRendererConfig>>,
    creationKey,
    onFrame,
    onResizeRequest,
    onError,
  } = options

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [canvasVersion, setCanvasVersion] = useState(0)
  const setCanvasRef = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element
    setCanvasVersion((value) => value + 1)
  }, [])
  const rendererRef = useRef<RendererInstance<TRendererConfig> | null>(null)
  const statusRef = useRef<RendererSessionStatus>('idle')
  const [status, setStatus] = useState<RendererSessionStatus>('idle')
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  const snapshotRef = useRef<RendererInstance<TRendererConfig>['runtime']['snapshot'] | null>(
    null,
  )
  const diagnosticsRef = useRef<RendererFrameEvent<TRendererConfig>['diagnostics'] | null>(
    null,
  )
  const lastFrameRef = useRef<RendererFrameEvent<TRendererConfig> | null>(null)
  const pendingEventsRef = useRef<RendererEvent<TRendererConfig>[]>([])
  const resizeOffRef = useRef<(() => void) | null>(null)
  const frameOffRef = useRef<(() => void) | null>(null)
  const creationKeyRef = useRef<string | undefined>(undefined)
  const configurationRef = useRef(configuration)
  const profileRef = useRef(profile)
  const factoryOptionsRef = useRef(factoryOptions)

  const updateStatus = useCallback((next: RendererSessionStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const reportError = useCallback(
    (cause: unknown, context: UseRendererSessionErrorContext) => {
      const err = cause instanceof Error ? cause : new Error(String(cause))
      setError(err)
      updateStatus('error')
      onError?.(err, context)
    },
    [onError, updateStatus],
  )

  const detachSurface = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    if (frameOffRef.current) {
      frameOffRef.current()
      frameOffRef.current = null
    }

    if (resizeOffRef.current) {
      resizeOffRef.current()
      resizeOffRef.current = null
    }

    try {
      renderer.unmount()
    } catch (cause) {
      reportError(cause, { phase: 'unmount' })
    }
  }, [reportError])

  const disposeRenderer = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    detachSurface()
    rendererRef.current = null

    try {
      renderer.free()
    } catch (cause) {
      reportError(cause, { phase: 'unmount' })
    }
  }, [detachSurface, reportError])

  const flushPendingEvents = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    const events = pendingEventsRef.current
    if (events.length === 0) {
      return
    }

    pendingEventsRef.current = []
    for (const event of events) {
      try {
        renderer.dispatch(event)
      } catch (cause) {
        reportError(cause, { phase: 'dispatch', meta: { event } })
        break
      }
    }
  }, [reportError])

  const dispatch = useCallback(
    (event: RendererEvent<TRendererConfig>) => {
      const renderer = rendererRef.current
      if (!renderer) {
        pendingEventsRef.current.push(event)
        return
      }

      try {
        renderer.dispatch(event)
      } catch (cause) {
        reportError(cause, { phase: 'dispatch', meta: { event } })
      }
    },
    [reportError],
  )

  const mountRenderer = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    const surface = canvasRef.current
    if (!surface) {
      return
    }

    if (frameOffRef.current) {
      return
    }

    try {
      renderer.mount({ renderRoot: surface })
    } catch (cause) {
      reportError(cause, { phase: 'mount' })
      return
    }

    frameOffRef.current = renderer.onFrame((event) => {
      snapshotRef.current = renderer.runtime.snapshot
      diagnosticsRef.current = event.diagnostics ?? null
      lastFrameRef.current = event
      setSnapshotVersion((value) => value + 1)
      onFrame?.(event)
    })

    resizeOffRef.current = renderer.onResizeRequest?.((event) => {
      onResizeRequest?.(event)
    })

    snapshotRef.current = renderer.runtime.snapshot
    diagnosticsRef.current = null
    lastFrameRef.current = null
    setSnapshotVersion((value) => value + 1)

    flushPendingEvents()
  }, [flushPendingEvents, onFrame, onResizeRequest, reportError])

  useEffect(() => {
    if (!rendererRef.current) {
      return
    }

    const surface = canvasRef.current
    if (surface) {
      mountRenderer()
      return
    }

    if (!surface && frameOffRef.current) {
      detachSurface()
    }
  }, [canvasVersion, detachSurface, mountRenderer])

  useEffect(() => {
    const shouldRecreate = creationKey !== undefined
    if (shouldRecreate && creationKeyRef.current !== creationKey) {
      creationKeyRef.current = creationKey
      disposeRenderer()
      updateStatus('idle')
    }
  }, [creationKey, disposeRenderer, updateStatus])

  useEffect(() => {
    configurationRef.current = configuration
  }, [configuration])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  useEffect(() => {
    factoryOptionsRef.current = factoryOptions
  }, [factoryOptions])

  useEffect(() => {
    const alreadyReady = rendererRef.current !== null
    if (alreadyReady) {
      return
    }

    const configurationSnapshot = configurationRef.current
    const profileSnapshot = profileRef.current
    const factoryOptionsSnapshot = factoryOptionsRef.current

    if (!configurationSnapshot) {
      return
    }

    const hasGrid =
      configurationSnapshot.grid.rows > 0 &&
      configurationSnapshot.grid.columns > 0
    if (!hasGrid) {
      return
    }

    let cancelled = false
    updateStatus('loading')

    const launch = async () => {
      try {
        const baseOptions = (factoryOptionsSnapshot ?? {}) as Partial<
          Omit<CreateRendererOptions<TRendererConfig>, 'rendererConfig'>
        >
        const payload = {
          ...baseOptions,
          rendererConfig: configurationSnapshot,
        } as CreateRendererOptions<TRendererConfig>

        if (!('profile' in baseOptions) || baseOptions.profile === undefined) {
          ;(payload as { profile?: TerminalProfile }).profile = profileSnapshot
        }

        const instance = await factory(payload)

        if (cancelled) {
          instance.free()
          return
        }

        rendererRef.current = instance
        updateStatus('ready')
        mountRenderer()
        dispatch({ type: 'profile.update', profile: profileSnapshot })
        dispatch({ type: 'renderer.configure', configuration: configurationSnapshot })
      } catch (cause) {
        if (cancelled) {
          return
        }
        reportError(cause, { phase: 'create' })
      }
    }

    void launch()

    return () => {
      cancelled = true
      disposeRenderer()
    }
  }, [dispatch, factory, mountRenderer, reportError, disposeRenderer, updateStatus])

  useEffect(() => {
    if (!rendererRef.current) {
      return
    }
    dispatch({ type: 'renderer.configure', configuration })
  }, [configuration, dispatch])

  useEffect(() => {
    if (!rendererRef.current) {
      return
    }
    dispatch({ type: 'profile.update', profile })
  }, [dispatch, profile])

  const snapshot = snapshotRef.current
  const diagnostics = diagnosticsRef.current
  const lastFrame = lastFrameRef.current
  const rendererInstance = rendererRef.current

  return useMemo<RendererSessionHandle<TRendererConfig>>(
    () => ({
      status,
      renderer: rendererInstance,
      canvasRef: setCanvasRef,
      dispatch,
      snapshot,
      snapshotVersion,
      diagnostics,
      lastFrame,
      error,
    }),
    [
      status,
      rendererInstance,
      setCanvasRef,
      dispatch,
      snapshot,
      snapshotVersion,
      diagnostics,
      lastFrame,
      error,
    ],
  )
}
