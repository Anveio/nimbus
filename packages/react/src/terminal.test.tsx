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
import { fireEvent, render } from '@testing-library/react'
import { act } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
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

  it('dispatches runtime pointer and wheel events from canvas interactions', async () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)

    const listeners = new Map<string, EventListener>()
    const addEventListenerSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'addEventListener')
      .mockImplementation(function (
        this: HTMLCanvasElement,
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        let handler: EventListener | null = null
        if (typeof listener === 'function') {
          handler = listener
        } else if (
          listener &&
          typeof (listener as EventListenerObject).handleEvent === 'function'
        ) {
          handler = (listener as EventListenerObject).handleEvent.bind(listener)
        }
        if (handler) {
          listeners.set(type, handler)
        }
        return undefined
      })

    const removeEventListenerSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'removeEventListener')
      .mockImplementation(function (this: HTMLCanvasElement, type: string) {
        listeners.delete(type)
        return undefined
      })

    try {
      const { container: host } = render(<Terminal />)
      const managed = host.querySelector('canvas') as HTMLCanvasElement

      Object.defineProperty(managed, 'getBoundingClientRect', {
        value: () => ({
          left: 0,
          top: 0,
          width: configuration.cssPixels.width,
          height: configuration.cssPixels.height,
          right: configuration.cssPixels.width,
          bottom: configuration.cssPixels.height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
        configurable: true,
      })

      Object.defineProperty(managed, 'setPointerCapture', {
        value: vi.fn(),
        configurable: true,
      })
      Object.defineProperty(managed, 'releasePointerCapture', {
        value: vi.fn(),
        configurable: true,
      })

      await act(async () => {
        await Promise.resolve()
      })

      sessionHarness.dispatch.mockClear()

      const pointerDown = listeners.get('pointerdown')
      expect(pointerDown).toBeDefined()
      pointerDown!({
        pointerId: 5,
        button: 0,
        buttons: 1,
        clientX: 4,
        clientY: 4,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent)

      expect(sessionHarness.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'runtime.pointer',
          action: 'down',
          pointerId: 5,
          button: 'left',
          buttons: 1,
          cell: { row: 1, column: 1 },
          position: { x: 4, y: 4 },
        }),
      )
      expect(
        (managed.setPointerCapture as unknown as Mock).mock.calls,
      ).toContainEqual([5])

      sessionHarness.dispatch.mockClear()

      const pointerMove = listeners.get('pointermove')
      expect(pointerMove).toBeDefined()
      pointerMove!({
        pointerId: 5,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 18,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent)

      expect(sessionHarness.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'runtime.pointer',
          action: 'move',
          pointerId: 5,
          cell: { row: 2, column: 3 },
          modifiers: expect.objectContaining({ alt: true, shift: true }),
        }),
      )

      sessionHarness.dispatch.mockClear()

      const pointerUp = listeners.get('pointerup')
      expect(pointerUp).toBeDefined()
      pointerUp!({
        pointerId: 5,
        button: 0,
        buttons: 0,
        clientX: 12,
        clientY: 16,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent)

      expect(sessionHarness.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'runtime.pointer',
          action: 'up',
          pointerId: 5,
          buttons: 0,
        }),
      )
      expect(
        (managed.releasePointerCapture as unknown as Mock).mock.calls,
      ).toContainEqual([5])

      sessionHarness.dispatch.mockClear()

      const wheel = listeners.get('wheel')
      expect(wheel).toBeDefined()
      const wheelPreventDefault = vi.fn()
      wheel!({
        deltaX: 15,
        deltaY: -30,
        clientX: 24,
        clientY: 32,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: wheelPreventDefault,
      } as unknown as WheelEvent)

      expect(sessionHarness.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'runtime.wheel',
          deltaX: 15,
          deltaY: -30,
          cell: { row: 3, column: 4 },
          modifiers: expect.objectContaining({ ctrl: true }),
        }),
      )
      expect(wheelPreventDefault).toHaveBeenCalledTimes(1)
    } finally {
      addEventListenerSpy.mockRestore()
      removeEventListenerSpy.mockRestore()
    }
  })

  it('dispatches runtime paste events from clipboard interactions', async () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    registerHarnessBackend(sessionHarness, rendererHarness)

    const { getAllByTestId } = render(<Terminal />)

    await act(async () => {
      await Promise.resolve()
    })

    sessionHarness.dispatch.mockClear()

    const boundaries = getAllByTestId('terminal-hotkeys-boundary')
    const boundary = boundaries[boundaries.length - 1] as
      | HTMLElement
      | undefined
    if (!boundary) {
      throw new Error('Terminal hotkey boundary not found')
    }
    boundary.focus()

    const clipboardData = {
      getData: (type: string) =>
        type === 'text' || type === 'text/plain' ? 'terminal paste' : '',
    }

    fireEvent.paste(boundary, { clipboardData })

    expect(sessionHarness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'runtime.paste',
        text: 'terminal paste',
      }),
    )
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
