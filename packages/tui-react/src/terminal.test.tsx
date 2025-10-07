import { render } from '@testing-library/react'
import { act } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import * as WebglRenderer from '@mana/webgl-renderer'
import type {
  RendererConfiguration,
  RendererFrameEvent,
  RendererResizeRequestEvent,
  RendererRoot,
  RendererRootContainer,
  RendererSession,
  TerminalProfile,
  WebglRendererConfig,
  WebglRendererRootOptions,
} from '@mana/webgl-renderer'
import type { TerminalRuntime } from '@mana/vt'
import { Terminal } from './terminal'

type FrameListener = Parameters<RendererSession['onFrame']>[0]
type ResizeRequestListener = Parameters<NonNullable<RendererSession['onResizeRequest']>>[0]

type SessionHarness = {
  session: RendererSession
  dispatch: ReturnType<typeof vi.fn>
  onFrame: ReturnType<typeof vi.fn>
  onResizeRequest: ReturnType<typeof vi.fn>
  unmount: ReturnType<typeof vi.fn>
  free: ReturnType<typeof vi.fn>
  emitFrame(event: RendererFrameEvent): void
  emitResizeRequest(event: RendererResizeRequestEvent): void
}

const createSessionHarness = (): SessionHarness => {
  const frameListeners = new Set<FrameListener>()
  const resizeListeners = new Set<ResizeRequestListener>()

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

  const session: RendererSession = {
    profile: {},
    runtime: {} as TerminalRuntime,
    configuration: undefined,
    dispatch: dispatch as RendererSession['dispatch'],
    onFrame: onFrameMock as RendererSession['onFrame'],
    onResizeRequest:
      onResizeRequestMock as NonNullable<RendererSession['onResizeRequest']>,
    unmount: unmount as RendererSession['unmount'],
    free: free as RendererSession['free'],
  }

  return {
    session,
    dispatch,
    onFrame: onFrameMock,
    onResizeRequest: onResizeRequestMock,
    unmount,
    free,
    emitFrame(event) {
      frameListeners.forEach((listener) => listener(event))
    },
    emitResizeRequest(event) {
      resizeListeners.forEach((listener) => listener(event))
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

const configuration: RendererConfiguration = {
  grid: { rows: 24, columns: 80 },
  cssPixels: { width: 640, height: 384 },
  devicePixelRatio: 1,
  framebufferPixels: { width: 640, height: 384 },
  cell: { width: 8, height: 16, baseline: 12 },
}

const ansiPalette = Array.from({ length: 16 }, (_, index) =>
  index % 2 === 0 ? '#000000' : '#ffffff',
)

const actualCreateRendererRoot = WebglRenderer.createRendererRoot
const createRendererRootSpy = vi.spyOn(WebglRenderer, 'createRendererRoot')

const originalCanvasGetBoundingClientRect =
  HTMLCanvasElement.prototype.getBoundingClientRect
const devicePixelRatioDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'devicePixelRatio',
)

const mockCanvasRect = () => ({
  width: configuration.cssPixels.width,
  height: configuration.cssPixels.height,
  top: 0,
  left: 0,
  bottom: configuration.cssPixels.height,
  right: configuration.cssPixels.width,
  x: 0,
  y: 0,
  toJSON() {
    return {}
  },
}) as DOMRect

class ResizeObserverMock {
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(private readonly callback: ResizeObserverCallback) {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

const resizeObservers: ResizeObserverMock[] = []

beforeEach(() => {
  resizeObservers.length = 0
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = vi
    .fn()
    .mockImplementation((callback: ResizeObserverCallback) => {
      const instance = new ResizeObserverMock(callback)
      resizeObservers.push(instance)
      return instance
    })
  HTMLCanvasElement.prototype.getBoundingClientRect = mockCanvasRect
  createRendererRootSpy.mockImplementation(actualCreateRendererRoot)
  Object.defineProperty(window, 'devicePixelRatio', {
    value: configuration.devicePixelRatio,
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  resizeObservers.length = 0
  HTMLCanvasElement.prototype.getBoundingClientRect =
    originalCanvasGetBoundingClientRect
  if (devicePixelRatioDescriptor) {
    Object.defineProperty(window, 'devicePixelRatio', devicePixelRatioDescriptor)
  } else {
    delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio
  }
  createRendererRootSpy.mockReset()
  createRendererRootSpy.mockImplementation(actualCreateRendererRoot)
})

describe('<Terminal />', () => {
  it('creates a managed container and mounts the renderer', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    createRendererRootSpy.mockImplementation(rendererHarness.factory)

    const { container: host } = render(
      <Terminal />,
    )

    const managed = host.querySelector('canvas') as HTMLCanvasElement

    expect(createRendererRootSpy).toHaveBeenCalledTimes(1)
    expect(rendererHarness.factory).toHaveBeenCalledTimes(1)
    expect(rendererHarness.container()).toBe(managed)
    expect(rendererHarness.mount).toHaveBeenCalledTimes(1)
    const options = rendererHarness.options()
    expect(options?.configuration).toEqual(configuration)
    expect(options?.runtime).toBeDefined()
    expect(resizeObservers).toHaveLength(1)
    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(managed)
    expect(sessionHarness.unmount).not.toHaveBeenCalled()
    expect(sessionHarness.free).not.toHaveBeenCalled()
  })

  it('dispatches configuration updates on resize and resize requests', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    createRendererRootSpy.mockImplementation(rendererHarness.factory)
    const onFrame = vi.fn((event: RendererFrameEvent) => {
      return event
    })
    const onResizeRequest = vi.fn(
      (event: RendererResizeRequestEvent) => event,
    )

    render(
      <Terminal
        onFrame={onFrame}
        onResizeRequest={onResizeRequest}
      />,
    )

    expect(sessionHarness.onFrame).toHaveBeenCalledTimes(1)
    sessionHarness.emitFrame({ timestamp: 0, approxFrameDuration: null })
    expect(onFrame).toHaveBeenCalledTimes(1)

    expect(resizeObservers).toHaveLength(1)
    act(() => {
      resizeObservers[0]?.trigger()
    })

    expect(sessionHarness.dispatch).toHaveBeenCalledWith({
      type: 'renderer.configure',
      configuration,
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
    expect(sessionHarness.dispatch).toHaveBeenCalledWith({
      type: 'renderer.configure',
      configuration,
    })
  })

  it('updates profile without remounting the renderer', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    createRendererRootSpy.mockImplementation(rendererHarness.factory)

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

    rerender(
      <Terminal rendererConfig={{ profile: profileB }} />,
    )

    expect(rendererHarness.mount).toHaveBeenCalledTimes(1)
    expect(sessionHarness.dispatch).toHaveBeenCalledWith({
      type: 'profile.update',
      profile: profileB,
    })
  })

  it('disposes the renderer root on unmount', () => {
    const sessionHarness = createSessionHarness()
    const rendererHarness = createRendererHarness(sessionHarness.session)
    createRendererRootSpy.mockImplementation(rendererHarness.factory)

    const { unmount } = render(
      <Terminal />,
    )

    expect(rendererHarness.dispose).not.toHaveBeenCalled()

    unmount()

    expect(sessionHarness.unmount).toHaveBeenCalledTimes(1)
    expect(sessionHarness.free).toHaveBeenCalledTimes(1)
    expect(rendererHarness.dispose).toHaveBeenCalledTimes(1)
  })
})
