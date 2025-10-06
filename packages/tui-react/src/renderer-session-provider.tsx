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
  type RenderSurface,
  type RendererConfiguration,
  type RendererMountDescriptor,
  type RendererRootContainer,
  type RendererSession,
  type TerminalProfile,
  type WebglRendererConfig,
} from '@mana/webgl-renderer'
import { createTerminalRuntime } from '@mana/vt'
import type { TerminalRuntime } from '@mana/vt'
import {
  type RendererSessionProviderProps,
  type TerminalSurfaceStrategy,
} from './renderer-contract'
import { useRendererRoot } from './renderer-root-context'
import {
  RendererSessionContextProvider,
  type RendererSessionContextValue,
} from './renderer-session-context'

const defaultSurfaceStrategy: TerminalSurfaceStrategy = ({ container }) => ({
  renderRoot: container,
})

const assertHTMLElement = (
  container: RendererRootContainer,
): container is HTMLElement => {
  return typeof HTMLElement !== 'undefined' && container instanceof HTMLElement
}

export const RendererSessionProvider = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: RendererSessionProviderProps<TRendererConfig>,
): JSX.Element | null => {
  const {
    rendererConfig,
    runtime,
    profile,
    deriveConfiguration,
    surface,
    onFrame,
    onResizeRequest,
    children,
  } = props

  const root = useRendererRoot<TRendererConfig>()

  const rendererConfigRef = useRef<Partial<TRendererConfig> | undefined>(rendererConfig)
  const surfaceStrategyRef = useRef<TerminalSurfaceStrategy<TRendererConfig>>(
    (surface ?? (defaultSurfaceStrategy as TerminalSurfaceStrategy<TRendererConfig>)),
  )
  const configurationStrategyRef = useRef(deriveConfiguration)
  const runtimeRef = useRef<TerminalRuntime | null>(runtime ?? null)
  const profileRef = useRef<TerminalProfile | undefined>(profile)
  const previousProfileRef = useRef<TerminalProfile | undefined>(undefined)
  const sessionRef = useRef<RendererSession<TRendererConfig> | null>(null)

  const [sessionState, setSessionState] = useState<RendererSession<TRendererConfig> | null>(
    null,
  )

  useEffect(() => {
    rendererConfigRef.current = rendererConfig
  }, [rendererConfig])

  useEffect(() => {
    surfaceStrategyRef.current =
      surface ?? (defaultSurfaceStrategy as TerminalSurfaceStrategy<TRendererConfig>)
  }, [surface])

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

  const computeSurface = useCallback((): RenderSurface<TRendererConfig> => {
    const container = root.container
    if (!assertHTMLElement(container)) {
      throw new Error('Renderer session provider requires an HTMLElement container.')
    }
    return surfaceStrategyRef.current({
      container,
      rendererConfig: rendererConfigRef.current,
    })
  }, [root])

  const computeConfiguration = useCallback(
    (
      container: HTMLElement,
      surfaceDescriptor: RenderSurface<TRendererConfig>,
    ): RendererConfiguration => {
      return configurationStrategyRef.current({
        container,
        surface: surfaceDescriptor,
      })
    },
    [],
  )

  const dispatchConfiguration = useCallback(() => {
    const session = sessionRef.current
    const container = root.container
    if (!session || !assertHTMLElement(container)) {
      return
    }
    const surfaceDescriptor = computeSurface()
    const configuration = computeConfiguration(container, surfaceDescriptor)
    session.dispatch({ type: 'renderer.configure', configuration })
  }, [computeConfiguration, computeSurface, root])

  useLayoutEffect(() => {
    const container = root.container
    if (!assertHTMLElement(container)) {
      throw new Error('Renderer session provider requires an HTMLElement container.')
    }

    const surfaceDescriptor = computeSurface()
    const runtimeInstance = runtimeRef.current ?? createTerminalRuntime()
    runtimeRef.current = runtimeInstance

    const configuration = computeConfiguration(container, surfaceDescriptor)

    const descriptor = Object.assign(
      {},
      rendererConfigRef.current ?? {},
      {
        surface: surfaceDescriptor,
        configuration,
        runtime: runtimeInstance,
      },
      profileRef.current ? { profile: profileRef.current } : {},
    ) as RendererMountDescriptor<TRendererConfig>

    const session = root.mount(descriptor)
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
    }
  }, [computeConfiguration, computeSurface, root])

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
    const container = root.container
    if (!assertHTMLElement(container)) {
      return
    }

    if (!sessionState) {
      return
    }

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      dispatchConfiguration()
    })

    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [sessionState, dispatchConfiguration, root])

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

  const contextValue: RendererSessionContextValue<TRendererConfig> = useMemo(
    () => ({
      session: sessionRef.current,
      runtime: runtimeRef.current,
    }),
    [sessionState, runtime],
  )

  if (!sessionState) {
    return null
  }

  return (
    <RendererSessionContextProvider value={contextValue}>
      {children}
    </RendererSessionContextProvider>
  )
}
