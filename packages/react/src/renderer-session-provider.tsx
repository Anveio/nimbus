import type {
  RendererConfigurationController,
  RendererRoot,
  RendererSession,
  TerminalProfile,
  TerminalRuntime,
} from '@nimbus/webgl-renderer'
import { deriveRendererConfiguration } from '@nimbus/webgl-renderer'
import type { JSX } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './backends/webgl'
import {
  getDefaultRendererBackendKey,
  getRendererBackend,
} from './renderer-backend-registry'
import type { RendererSessionProviderProps } from './renderer-contract'
import { RendererRootProvider } from './renderer-root-context'
import {
  RendererSessionContextProvider,
  type RendererSessionContextValue,
} from './renderer-session-context'
import { useRendererSurface } from './renderer-surface-context'

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
  const configurationControllerRef =
    useRef<RendererConfigurationController | null>(null)

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

    const controller = deriveRendererConfiguration(canvas, {
      minimumGrid: { rows: 1, columns: 1 },
    })
    configurationControllerRef.current = controller

    const runtimeInstance =
      runtimeRef.current ?? backend.createRuntime(rendererConfigRef.current)
    runtimeRef.current = runtimeInstance
    setRuntimeState(runtimeInstance)

    const configuration = controller.refresh()

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

    const unsubscribeFromController = controller.subscribe(
      (nextConfiguration) => {
        const activeSession = sessionRef.current
        if (!activeSession) {
          return
        }
        activeSession.dispatch({
          type: 'renderer.configure',
          configuration: nextConfiguration,
        })
      },
    )

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
      unsubscribeFromController()
      if (configurationControllerRef.current === controller) {
        configurationControllerRef.current = null
      }
      controller.dispose()
    }
  }, [canvas, resolvedBackendKey])

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
      configurationControllerRef.current?.refresh()
    })
  }, [sessionState, onResizeRequest])

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
