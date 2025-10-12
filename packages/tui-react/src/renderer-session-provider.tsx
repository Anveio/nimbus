import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { JSX, ReactNode } from 'react'
import {
  createRendererRoot,
  RendererConfiguration,
  RendererSession,
  TerminalProfile,
  WebglRendererConfig,
  type RendererRoot,
  type WebglRendererRootOptions,
} from '@nimbus/webgl-renderer'
import { createTerminalRuntime } from '@nimbus/webgl-renderer'
import type { TerminalRuntime } from '@nimbus/webgl-renderer'
import type { RendererSessionProviderProps } from './renderer-contract'
import { RendererRootProvider } from './renderer-root-context'
import { useRendererSurface } from './renderer-surface-context'
import {
  RendererSessionContextProvider,
  type RendererSessionContextValue,
} from './renderer-session-context'

const FALLBACK_CELL_METRICS = Object.freeze({
  width: 8,
  height: 16,
  baseline: 12,
})

const DEFAULT_CANVAS_WIDTH = 640
const DEFAULT_CANVAS_HEIGHT = 384

const computeFallbackConfiguration = (
  canvas: HTMLCanvasElement,
): RendererConfiguration => {
  const rect = typeof canvas.getBoundingClientRect === 'function'
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

  const framebufferWidth = Math.max(
    1,
    Math.round(cssWidth * devicePixelRatio),
  )
  const framebufferHeight = Math.max(
    1,
    Math.round(cssHeight * devicePixelRatio),
  )

  const columns = Math.max(
    1,
    Math.floor(cssWidth / FALLBACK_CELL_METRICS.width),
  )
  const rows = Math.max(
    1,
    Math.floor(cssHeight / FALLBACK_CELL_METRICS.height),
  )

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
    rendererConfig,
    onFrame,
    onResizeRequest,
    children,
  } = props

  const canvas = useRendererSurface()

  const rendererConfigRef =
    useRef<RendererSessionProviderProps['rendererConfig']>(rendererConfig)
  const runtimeRef = useRef<TerminalRuntime | null>(
    rendererConfig?.runtime ?? null,
  )
  const profileRef = useRef<TerminalProfile | undefined>(
    rendererConfig?.profile,
  )
  const previousProfileRef = useRef<TerminalProfile | undefined>(
    rendererConfig?.profile,
  )
  const rootRef = useRef<RendererRoot<WebglRendererConfig> | null>(null)
  const sessionRef = useRef<RendererSession | null>(null)

  const [rootState, setRootState] =
    useState<RendererRoot<WebglRendererConfig> | null>(null)
  const [sessionState, setSessionState] = useState<RendererSession | null>(
    null,
  )

  useEffect(() => {
    rendererConfigRef.current = rendererConfig
    runtimeRef.current = rendererConfig?.runtime ?? null
    profileRef.current = rendererConfig?.profile
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
    const runtimeInstance = runtimeRef.current ?? createTerminalRuntime()
    runtimeRef.current = runtimeInstance

    const configuration = computeConfiguration()

    const currentRendererConfig = rendererConfigRef.current ?? {}

    const options = Object.assign(
      {},
      currentRendererConfig,
      {
        configuration,
        runtime: runtimeInstance,
      },
      profileRef.current !== undefined
        ? { profile: profileRef.current }
        : {},
    ) as WebglRendererRootOptions

    const root = createRendererRoot(canvas, options)
    rootRef.current = root
    setRootState(root)

    const session = root.mount()
    sessionRef.current = session
    setSessionState(session)

    if (profileRef.current !== undefined) {
      session.dispatch({ type: 'profile.update', profile: profileRef.current })
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
      root.dispose()
    }
  }, [canvas, computeConfiguration])

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
    const nextProfile = rendererConfig?.profile
    if (!session || nextProfile === undefined) {
      previousProfileRef.current = nextProfile
      return
    }
    if (previousProfileRef.current === nextProfile) {
      return
    }
    session.dispatch({ type: 'profile.update', profile: nextProfile })
    previousProfileRef.current = nextProfile
  }, [sessionState, rendererConfig?.profile])

  const contextValue: RendererSessionContextValue = useMemo(
    () => ({
      session: sessionRef.current,
      runtime: runtimeRef.current,
    }),
    [sessionState, rendererConfig?.runtime],
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
