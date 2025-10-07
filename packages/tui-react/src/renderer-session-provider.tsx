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
} from '@mana/webgl-renderer'
import { createTerminalRuntime } from '@mana/vt'
import type { TerminalRuntime } from '@mana/vt'
import type {
  RendererSessionProviderProps,
  TerminalRendererFactory,
} from './renderer-contract'
import { RendererRootProvider } from './renderer-root-context'
import { useRendererSurface } from './renderer-surface-context'
import {
  RendererSessionContextProvider,
  type RendererSessionContextValue,
} from './renderer-session-context'

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
    rendererFactory,
    rendererConfig,
    runtime,
    profile,
    deriveConfiguration,
    onFrame,
    onResizeRequest,
    children,
  } = props

  const canvas = useRendererSurface()

  const rendererFactoryRef = useRef<TerminalRendererFactory | null>(
    rendererFactory ?? null,
  )
  const rendererConfigRef = useRef<Partial<WebglRendererConfig> | undefined>(
    rendererConfig,
  )
  const configurationStrategyRef = useRef(deriveConfiguration)
  const runtimeRef = useRef<TerminalRuntime | null>(runtime ?? null)
  const profileRef = useRef<TerminalProfile | undefined>(profile)
  const previousProfileRef = useRef<TerminalProfile | undefined>(undefined)
  const rootRef = useRef<RendererRoot<WebglRendererConfig> | null>(null)
  const sessionRef = useRef<RendererSession | null>(null)

  const [rootState, setRootState] = useState<RendererRoot<WebglRendererConfig> | null>(null)
  const [sessionState, setSessionState] = useState<RendererSession | null>(
    null,
  )

  useEffect(() => {
    rendererFactoryRef.current = rendererFactory ?? null
  }, [rendererFactory])

  useEffect(() => {
    rendererConfigRef.current = rendererConfig
  }, [rendererConfig])

  useEffect(() => {
    configurationStrategyRef.current = deriveConfiguration
  }, [deriveConfiguration])

  useEffect(() => {
    if (runtime) {
      runtimeRef.current = runtime
    }
  }, [runtime])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  const computeConfiguration = useCallback(
    (): RendererConfiguration => {
      return configurationStrategyRef.current({
        container: canvas,
      })
    },
    [canvas],
  )

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

    const options = Object.assign(
      {},
      rendererConfigRef.current ?? {},
      {
        configuration,
        runtime: runtimeInstance,
      },
      profileRef.current ? { profile: profileRef.current } : {},
    ) as WebglRendererRootOptions

    const factory = rendererFactoryRef.current ?? createRendererRoot
    const root = factory(canvas, options)
    rootRef.current = root
    setRootState(root)

    const session = root.mount()
    sessionRef.current = session
    setSessionState(session)

    if (profileRef.current) {
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
  }, [canvas, computeConfiguration, rendererFactory])

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
    if (!session || !profile) {
      previousProfileRef.current = profile
      return
    }
    if (previousProfileRef.current === profile) {
      return
    }
    session.dispatch({ type: 'profile.update', profile })
    previousProfileRef.current = profile
  }, [sessionState, profile])

  const contextValue: RendererSessionContextValue = useMemo(
    () => ({
      session: sessionRef.current,
      runtime: runtimeRef.current,
    }),
    [sessionState, runtime],
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
