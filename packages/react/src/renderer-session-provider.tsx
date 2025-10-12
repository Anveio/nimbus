import type {
  RendererConfiguration,
  RendererRoot,
  RendererSession,
  TerminalProfile,
  TerminalRuntime,
} from '@nimbus/webgl-renderer'
import type { JSX } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  getDefaultRendererBackendKey,
  getRendererBackend,
} from './renderer-backend-registry'
import type { RendererSessionProviderProps } from './renderer-contract'
import './backends/webgl'
import { RendererRootProvider } from './renderer-root-context'
import {
  RendererSessionContextProvider,
  type RendererSessionContextValue,
} from './renderer-session-context'
import { useRendererSurface } from './renderer-surface-context'

const FALLBACK_CELL_METRICS = Object.freeze({
  width: 8,
  height: 16,
  baseline: 12,
})

const DEFAULT_CANVAS_WIDTH = 640
const DEFAULT_CANVAS_HEIGHT = 384

const extractRuntime = (config: unknown): TerminalRuntime | null => {
  if (config && typeof config === 'object' && 'runtime' in config) {
    const value = (config as { readonly runtime?: TerminalRuntime | null })
      .runtime
    return value ?? null
  }
  return null
}

const extractProfile = (config: unknown): TerminalProfile | undefined => {
  if (config && typeof config === 'object' && 'profile' in config) {
    return (config as { readonly profile?: TerminalProfile }).profile
  }
  return undefined
}

const computeFallbackConfiguration = (
  canvas: HTMLCanvasElement,
): RendererConfiguration => {
  const rect =
    typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : { width: 0, height: 0 }
  const cssWidth =
    rect.width || canvas.clientWidth || canvas.width || DEFAULT_CANVAS_WIDTH
  const cssHeight =
    rect.height || canvas.clientHeight || canvas.height || DEFAULT_CANVAS_HEIGHT
  const devicePixelRatio =
    typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1

  const framebufferWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio))
  const framebufferHeight = Math.max(
    1,
    Math.round(cssHeight * devicePixelRatio),
  )

  const columns = Math.max(
    1,
    Math.floor(cssWidth / FALLBACK_CELL_METRICS.width),
  )
  const rows = Math.max(1, Math.floor(cssHeight / FALLBACK_CELL_METRICS.height))

  return {
    grid: { rows, columns },
    cssPixels: { width: cssWidth, height: cssHeight },
    devicePixelRatio,
    framebufferPixels: {
      width: framebufferWidth,
      height: framebufferHeight,
    },
    cell: { ...FALLBACK_CELL_METRICS },
  }
}

/**
 * Mounts and manages a renderer session once the host `HTMLCanvasElement`
 * becomes available. It wires runtime selection, configuration dispatch,
 * resize observers, and publishes the renderer root plus session/runtime
 * handles via context.
 */
export const RendererSessionProvider = (
  props: RendererSessionProviderProps,
): JSX.Element | null => {
  const {
    rendererBackend,
    rendererConfig,
    onFrame,
    onResizeRequest,
    onRuntimeResponse,
    children,
  } = props

  const canvas = useRendererSurface()

  const rendererConfigRef =
    useRef<RendererSessionProviderProps['rendererConfig']>(rendererConfig)
  const runtimeRef = useRef<TerminalRuntime | null>(
    extractRuntime(rendererConfig),
  )
  const profileRef = useRef<TerminalProfile | undefined>(
    extractProfile(rendererConfig),
  )
  const previousProfileRef = useRef<TerminalProfile | undefined>(
    extractProfile(rendererConfig),
  )
  const rootRef = useRef<RendererRoot | null>(null)
  const sessionRef = useRef<RendererSession | null>(null)

  const [rootState, setRootState] = useState<RendererRoot | null>(null)
  const [sessionState, setSessionState] = useState<RendererSession | null>(null)
  const [runtimeState, setRuntimeState] = useState<TerminalRuntime | null>(
    runtimeRef.current,
  )

  const resolvedBackendKey = useMemo(() => {
    if (rendererBackend) {
      return rendererBackend
    }
    if (
      rendererConfig &&
      typeof rendererConfig === 'object' &&
      'backend' in rendererConfig &&
      typeof (rendererConfig as { backend?: unknown }).backend === 'string'
    ) {
      const value = (rendererConfig as { backend?: string }).backend
      if (value) {
        return value
      }
    }
    return getDefaultRendererBackendKey()
  }, [rendererBackend, rendererConfig])

  const backendKeyRef = useRef<string>(resolvedBackendKey)

  useEffect(() => {
    rendererConfigRef.current = rendererConfig
    const nextRuntime = extractRuntime(rendererConfig)
    runtimeRef.current = nextRuntime
    setRuntimeState(nextRuntime)
    const nextProfile = extractProfile(rendererConfig)
    profileRef.current = nextProfile
  }, [rendererConfig])

  const computeConfiguration = useCallback((): RendererConfiguration => {
    return computeFallbackConfiguration(canvas)
  }, [canvas])

  const dispatchConfiguration = useCallback(() => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    const configuration = computeConfiguration()
    session.dispatch({ type: 'renderer.configure', configuration })
  }, [computeConfiguration])

  useLayoutEffect(() => {
    if (backendKeyRef.current !== resolvedBackendKey) {
      runtimeRef.current = extractRuntime(rendererConfigRef.current)
    }
    backendKeyRef.current = resolvedBackendKey

    const backend = getRendererBackend(resolvedBackendKey)
    if (!backend) {
      throw new Error(
        `Renderer backend "${resolvedBackendKey}" is not registered.`,
      )
    }

    const runtimeInstance =
      runtimeRef.current ?? backend.createRuntime(rendererConfigRef.current)
    runtimeRef.current = runtimeInstance
    setRuntimeState(runtimeInstance)

    const configuration = computeConfiguration()

    const mounted = backend.mount({
      canvas,
      configuration,
      profile: profileRef.current,
      rendererConfig: rendererConfigRef.current,
      runtime: runtimeInstance,
    })

    rootRef.current = mounted.root
    setRootState(mounted.root)
    sessionRef.current = mounted.session
    setSessionState(mounted.session)

    if (profileRef.current !== undefined) {
      mounted.session.dispatch({
        type: 'profile.update',
        profile: profileRef.current,
      })
      previousProfileRef.current = profileRef.current
    }

    return () => {
      const activeSession = sessionRef.current
      sessionRef.current = null
      if (activeSession) {
        activeSession.unmount()
        activeSession.free()
      }
      rootRef.current = null
      setSessionState(null)
      setRootState(null)
      mounted.root.dispose()
    }
  }, [canvas, computeConfiguration, resolvedBackendKey])

  useEffect(() => {
    if (!sessionState) {
      return
    }
    dispatchConfiguration()
  }, [sessionState, dispatchConfiguration])

  useEffect(() => {
    const session = sessionState
    if (!session || !onFrame) {
      return
    }
    return session.onFrame(onFrame)
  }, [sessionState, onFrame])

  useEffect(() => {
    const session = sessionState
    if (!session || !onRuntimeResponse) {
      return
    }
    return session.onRuntimeResponse(onRuntimeResponse)
  }, [sessionState, onRuntimeResponse])

  useEffect(() => {
    const session = sessionState
    if (!session || !session.onResizeRequest) {
      return
    }
    return session.onResizeRequest((event) => {
      onResizeRequest?.(event)
      dispatchConfiguration()
    })
  }, [sessionState, onResizeRequest, dispatchConfiguration])

  useEffect(() => {
    if (!sessionState) {
      return
    }

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      dispatchConfiguration()
    })

    observer.observe(canvas)

    return () => {
      observer.disconnect()
    }
  }, [sessionState, dispatchConfiguration, canvas])

  useEffect(() => {
    const session = sessionState
    const nextProfile = extractProfile(rendererConfig)
    if (!session || nextProfile === undefined) {
      previousProfileRef.current = nextProfile
      return
    }
    if (previousProfileRef.current === nextProfile) {
      return
    }
    session.dispatch({ type: 'profile.update', profile: nextProfile })
    previousProfileRef.current = nextProfile
  }, [sessionState, rendererConfig])

  const contextValue: RendererSessionContextValue = useMemo(
    () => ({
      session: sessionRef.current,
      runtime: runtimeState,
    }),
    [runtimeState],
  )

  if (!rootState || !sessionState) {
    return null
  }

  return (
    <RendererRootProvider value={rootState}>
      <RendererSessionContextProvider value={contextValue}>
        {children}
      </RendererSessionContextProvider>
    </RendererRootProvider>
  )
}
