import type * as WebglRenderer from '@nimbus/webgl-renderer'
import type {
  RendererConfiguration,
  RendererFrameEvent,
  RendererResizeRequestEvent,
  RendererRoot,
  RendererRootContainer,
  RendererSession,
  TerminalProfile,
  TerminalRuntimeResponse,
  WebglRendererConfig,
  WebglRendererRootOptions,
} from '@nimbus/webgl-renderer'
import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRendererBackendsForTests,
  registerRendererBackend,
} from './renderer-backend-registry'
import { Terminal } from './terminal'

const {
  baseConfiguration,
  controllers,
  deriveRendererConfigurationMock,
  getLastController,
} = vi.hoisted(() => {
  type Listener = (configuration: RendererConfiguration) => void

  const listenersMap = new WeakMap<object, Set<Listener>>()

  const cloneConfiguration = (configuration: RendererConfiguration) =>
    structuredClone(configuration) as RendererConfiguration

  class MockController {
    configuration: RendererConfiguration | null
    refresh: ReturnType<typeof vi.fn<() => RendererConfiguration>>
    subscribe: ReturnType<typeof vi.fn<(listener: Listener) => () => void>>
    dispose: ReturnType<typeof vi.fn<() => void>>

    constructor(initialConfiguration: RendererConfiguration) {
      this.configuration = cloneConfiguration(initialConfiguration)
      listenersMap.set(this, new Set())
      this.refresh = vi.fn(() => {
        const next = cloneConfiguration(initialConfiguration)
        this.configuration = next
        for (const listener of listenersMap.get(this) ?? []) {
          listener(next)
        }
        return next
      })
      this.subscribe = vi.fn((listener: Listener) => {
        const listeners = listenersMap.get(this)
        if (!listeners) {
          return () => {}
        }
        listeners.add(listener)
        if (this.configuration) {
          listener(this.configuration)
        }
        return () => {
          listeners.delete(listener)
        }
      })
      this.dispose = vi.fn(() => {
        listenersMap.set(this, new Set())
      })
    }

    emit(next: RendererConfiguration) {
      this.configuration = cloneConfiguration(next)
      for (const listener of listenersMap.get(this) ?? []) {
        listener(this.configuration)
      }
    }
  }

  const baseConfiguration = Object.freeze({
    grid: { rows: 24, columns: 80 },
    cssPixels: { width: 640, height: 384 },
    devicePixelRatio: 1,
    framebufferPixels: { width: 640, height: 384 },
    cell: { width: 8, height: 16, baseline: 12 },
  }) as RendererConfiguration

  const controllers: MockController[] = []

  const deriveRendererConfigurationMock = vi.fn(() => {
    const controller = new MockController(baseConfiguration)
    controllers.push(controller)
    return controller
  })

  const getLastController = () => controllers[controllers.length - 1] ?? null

  return {
    baseConfiguration,
    controllers,
    deriveRendererConfigurationMock,
    getLastController,
  }
})

vi.mock('@nimbus/webgl-renderer', async () => {
  const actual = await vi.importActual<typeof import('@nimbus/webgl-renderer')>(
    '@nimbus/webgl-renderer',
  )
  return {
    ...actual,
    deriveRendererConfiguration: deriveRendererConfigurationMock,
  }
})

type FrameListener = Parameters<RendererSession['onFrame']>[0]
type ResizeRequestListener = Parameters<
  NonNullable<RendererSession['onResizeRequest']>
>[0]
type ResponseListener = Parameters<RendererSession['onRuntimeResponse']>[0]

type SessionHarness = {
  session: RendererSession
  dispatch: ReturnType<typeof vi.fn>
  onFrame: ReturnType<typeof vi.fn>
  onResizeRequest: ReturnType<typeof vi.fn>
  onRuntimeResponse: ReturnType<typeof vi.fn>
  unmount: ReturnType<typeof vi.fn>
  free: ReturnType<typeof vi.fn>
  emitFrame(event: RendererFrameEvent): void
  emitResizeRequest(event: RendererResizeRequestEvent): void
  emitRuntimeResponse(event: TerminalRuntimeResponse): void
}

const createSessionHarness = (): SessionHarness => {
  const frameListeners = new Set<FrameListener>()
  const resizeListeners = new Set<ResizeRequestListener>()
  const responseListeners = new Set<ResponseListener>()

  const dispatch = vi.fn()
  const unmount = vi.fn()
  const free = vi.fn()

  const onFrameMock = vi.fn((listener: FrameListener) => {
    frameListeners.add(listener)
    return () => frameListeners.delete(listener)
  })

  const onResizeRequestMock = vi.fn((listener: ResizeRequestListener) => {
    resizeListeners.add(listener)
    return () => resizeListeners.delete(listener)
  })

  const onRuntimeResponseMock = vi.fn((listener: ResponseListener) => {
    responseListeners.add(listener)
    return () => responseListeners.delete(listener)
  })

  const session: RendererSession = {
    profile: {},
    runtime: {} as WebglRenderer.TerminalRuntime,
    configuration: undefined,
    dispatch: dispatch as RendererSession['dispatch'],
    onFrame: onFrameMock as RendererSession['onFrame'],
    onResizeRequest: onResizeRequestMock as NonNullable<
      RendererSession['onResizeRequest']
    >,
    onRuntimeResponse:
      onRuntimeResponseMock as RendererSession['onRuntimeResponse'],
    unmount: unmount as RendererSession['unmount'],
    free: free as RendererSession['free'],
  }

  return {
    session,
    dispatch,
    onFrame: onFrameMock,
    onResizeRequest: onResizeRequestMock,
    onRuntimeResponse: onRuntimeResponseMock,
    unmount,
    free,
    emitFrame(event) {
      frameListeners.forEach((listener) => {
        listener(event)
      })
    },
    emitResizeRequest(event) {
      resizeListeners.forEach((listener) => {
        listener(event)
      })
    },
    emitRuntimeResponse(event) {
      responseListeners.forEach((listener) => {
        listener(event)
      })
    },
  }
}

type RendererHarness = {
  factory: ReturnType<typeof vi.fn<typeof WebglRenderer.createRendererRoot>>
  mount: ReturnType<typeof vi.fn<() => RendererSession>>
  dispose: ReturnType<typeof vi.fn<() => void>>
  container: () => RendererRootContainer | null
  options: () => WebglRendererRootOptions | null
}

const createRendererHarness = (session: RendererSession): RendererHarness => {
  const mount = vi.fn(() => session)
  const dispose = vi.fn<() => void>(() => {})
  let currentContainer: RendererRootContainer | null = null
  let lastOptions: WebglRendererRootOptions | null = null

  const factoryImpl: typeof WebglRenderer.createRendererRoot = (
    container,
    options,
  ) => {
    currentContainer = container
    lastOptions = options

    const root: RendererRoot<WebglRendererConfig> = {
      container,
      get currentSession() {
        return session
      },
      mount: (() => {
        mount()
        return session
      }) as RendererRoot<WebglRendererConfig>['mount'],
      dispose: dispose as RendererRoot<WebglRendererConfig>['dispose'],
    }

    return root
  }

  const factory = vi.fn(factoryImpl)

  return {
    factory,
    mount,
    dispose,
    container: () => currentContainer,
    options: () => lastOptions,
  }
}

const registerHarnessBackend = (
  sessionHarness: SessionHarness,
  rendererHarness: RendererHarness,
) => {
  let runtimeInstance: WebglRenderer.TerminalRuntime | null = null
  registerRendererBackend('webgl', {
    createRuntime: vi.fn(() => {
      if (runtimeInstance) {
        return runtimeInstance
      }
      runtimeInstance = {} as WebglRenderer.TerminalRuntime
      return runtimeInstance
    }),
    mount: vi.fn(
      ({ canvas, configuration, profile, rendererConfig, runtime }) => {
        runtimeInstance = runtime as WebglRenderer.TerminalRuntime
        const options = Object.assign(
          {},
          (rendererConfig as Record<string, unknown>) ?? {},
          {
            configuration,
            runtime,
          },
          profile !== undefined ? { profile } : {},
        ) as WebglRendererRootOptions

        const root = rendererHarness.factory(canvas, options)
        const session = root.mount()
        sessionHarness.session = session
        return { root, session }
      },
    ),
  })
}

const configuration = baseConfiguration as RendererConfiguration

const ansiPalette = Array.from({ length: 16 }, (_, index) =>
  index % 2 === 0 ? '#000000' : '#ffffff',
)

beforeEach(() => {
  clearRendererBackendsForTests()
  controllers.length = 0
  deriveRendererConfigurationMock.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
  clearRendererBackendsForTests()
})

describe('<Terminal />', () => {
  it('creates a managed container and mounts the renderer', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)

    const { container: host } = render(<Terminal />)

    const managed = host.querySelector('canvas') as HTMLCanvasElement

    expect(rendererHarness.factory).toHaveBeenCalledTimes(1)
    expect(rendererHarness.container()).toBe(managed)
    expect(rendererHarness.mount).toHaveBeenCalledTimes(1)
    const options = rendererHarness.options()
    expect(options?.configuration).toEqual(configuration)
    expect(options?.runtime).toBeDefined()
    expect(deriveRendererConfigurationMock).toHaveBeenCalledTimes(1)
    expect(controllers).toHaveLength(1)
    const controller = getLastController()
    expect(controller?.refresh).toHaveBeenCalledTimes(1)
    expect(controller?.subscribe).toHaveBeenCalledTimes(1)
    expect(sessionHarness.unmount).not.toHaveBeenCalled()
    expect(sessionHarness.free).not.toHaveBeenCalled()
  })

  it('dispatches configuration updates on helper notifications and resize requests', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)
    const onFrame = vi.fn((event: RendererFrameEvent) => {
      return event
    })
    const onResizeRequest = vi.fn((event: RendererResizeRequestEvent) => event)

    render(<Terminal onFrame={onFrame} onResizeRequest={onResizeRequest} />)

    expect(sessionHarness.onFrame).toHaveBeenCalledTimes(1)
    sessionHarness.emitFrame({ timestamp: 0, approxFrameDuration: null })
    expect(onFrame).toHaveBeenCalledTimes(1)

    const controller = getLastController()
    expect(controller).toBeTruthy()
    sessionHarness.dispatch.mockClear()

    const nextConfiguration: RendererConfiguration = {
      ...configuration,
      grid: { rows: 32, columns: 100 },
    }

    controller?.emit(nextConfiguration)

    expect(sessionHarness.dispatch).toHaveBeenCalledWith({
      type: 'renderer.configure',
      configuration: nextConfiguration,
    })

    const resizeEvent: RendererResizeRequestEvent = {
      rows: 48,
      columns: 160,
      reason: 'remote',
    }

    sessionHarness.dispatch.mockClear()

    act(() => {
      sessionHarness.emitResizeRequest(resizeEvent)
    })

    expect(onResizeRequest).toHaveBeenCalledWith(resizeEvent)
    expect(controller?.refresh).toHaveBeenCalledTimes(2)
    expect(sessionHarness.dispatch).toHaveBeenCalledTimes(1)
  })

  it('registers runtime response listeners', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)
    const onRuntimeResponse = vi.fn()

    render(<Terminal onRuntimeResponse={onRuntimeResponse} />)

    expect(sessionHarness.onRuntimeResponse).toHaveBeenCalledTimes(1)

    const response: TerminalRuntimeResponse = {
      kind: 'pointer-report',
      data: new Uint8Array(),
    }

    act(() => {
      sessionHarness.emitRuntimeResponse(response)
    })

    expect(onRuntimeResponse).toHaveBeenCalledWith(response)
  })

  it('updates profile without remounting the renderer', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)

    const profileA: TerminalProfile = {
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: { color: '#ffffff' },
        palette: { ansi: ansiPalette },
      },
    }
    const profileB: TerminalProfile = {
      theme: {
        background: '#111111',
        foreground: '#eeeeee',
        cursor: { color: '#eeeeee' },
        palette: { ansi: ansiPalette },
      },
    }

    const { rerender } = render(
      <Terminal rendererConfig={{ profile: profileA }} />,
    )

    expect(rendererHarness.mount).toHaveBeenCalledTimes(1)
    expect(sessionHarness.dispatch).toHaveBeenCalledWith({
      type: 'profile.update',
      profile: profileA,
    })

    sessionHarness.dispatch.mockClear()

    rerender(<Terminal rendererConfig={{ profile: profileB }} />)

    expect(rendererHarness.mount).toHaveBeenCalledTimes(1)
    expect(sessionHarness.dispatch).toHaveBeenCalledWith({
      type: 'profile.update',
      profile: profileB,
    })
  })

  it('disposes the renderer root on unmount', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)

    const { unmount } = render(<Terminal />)

    expect(rendererHarness.dispose).not.toHaveBeenCalled()

    unmount()

    expect(sessionHarness.unmount).toHaveBeenCalledTimes(1)
    expect(sessionHarness.free).toHaveBeenCalledTimes(1)
    expect(rendererHarness.dispose).toHaveBeenCalledTimes(1)
  })
})
