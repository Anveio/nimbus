import { areSelectionsEqual } from '@mana/vt'
import type { TerminalSelection, TerminalState, TerminalUpdate } from '@mana/vt'
import { createCpuCanvasRenderer } from './backends/canvas/cpu'
import { createWebglCanvasRenderer } from './backends/webgl/renderer'
import type {
  CanvasRenderer,
  CanvasRendererOptions,
  CanvasRendererUpdateOptions,
  Cpu2dBackendConfig,
  CreateCanvasRenderer,
  CreateRendererSessionOptions,
  DetectPreferredBackendOptions,
  RendererBackendConfig,
  RendererBackendFallback,
  RendererBackendKind,
  RendererBackendProbeContext,
  RendererBackendProbeResult,
  RendererBackendProvider,
  RendererCursorDescriptor,
  RendererFrameMetadata,
  RendererFrameOverlays,
  RendererMetrics,
  RendererNextFrameMetadata,
  RendererSession,
  RendererSessionBackend,
  RendererSessionConfiguration,
  RendererSessionObservers,
  RendererTheme,
  WebglBackendConfig,
  WebglBackendProbeResult,
  WebgpuBackendConfig,
} from './types'

export * from './types'

const DEFAULT_BACKEND: RendererBackendConfig = { type: 'cpu-2d' }

const setRendererBackendDataset = (
  canvas: CanvasRendererOptions['canvas'],
  backend: RendererBackendKind,
): void => {
  if (!canvas) {
    return
  }
  const element = canvas as HTMLCanvasElement
  if (!element || typeof element !== 'object') {
    return
  }
  if (!('dataset' in element) || !element.dataset) {
    return
  }
  switch (backend) {
    case 'cpu-2d':
      element.dataset.manaRendererBackend = 'cpu'
      break
    case 'gpu-webgl':
      element.dataset.manaRendererBackend = 'webgl'
      break
    case 'gpu-webgpu':
      element.dataset.manaRendererBackend = 'webgpu'
      break
    default:
      element.dataset.manaRendererBackend = backend
      break
  }
}

const clearRendererBackendDataset = (
  canvas: CanvasRendererOptions['canvas'],
): void => {
  const element = canvas as HTMLCanvasElement
  if (!element || typeof element !== 'object') {
    return
  }
  if ('dataset' in element && element.dataset) {
    delete element.dataset.manaRendererBackend
  }
}

const readRendererBackendDataset = (
  canvas: CanvasRendererOptions['canvas'],
): RendererSessionBackend | null => {
  const element = canvas as HTMLCanvasElement
  if (!element || typeof element !== 'object') {
    return null
  }
  const datasetValue = element.dataset?.manaRendererBackend
  switch (datasetValue) {
    case 'cpu':
      return 'cpu-2d'
    case 'webgl':
      return 'gpu-webgl'
    case 'webgpu':
      return 'gpu-webgpu'
    case undefined:
      return null
    default:
      return 'custom'
  }
}

const cpuBackendProvider: RendererBackendProvider<Cpu2dBackendConfig> = {
  kind: 'cpu-2d',
  matches: (config): config is Cpu2dBackendConfig => config.type === 'cpu-2d',
  normalizeConfig: (_config) => ({ type: 'cpu-2d' }),
  probe: (_context, _config) => ({ kind: 'cpu-2d', supported: true }),
  create: (options, _config, _probe) =>
    createCpuCanvasRenderer({ ...options, backend: { type: 'cpu-2d' } }),
}

const webglBackendProvider: RendererBackendProvider<
  WebglBackendConfig,
  WebglBackendProbeResult
> = {
  kind: 'gpu-webgl',
  matches: (config): config is WebglBackendConfig =>
    config.type === 'gpu-webgl',
  normalizeConfig: (config) => ({
    type: 'gpu-webgl',
    contextAttributes: {
      preserveDrawingBuffer: true,
      alpha: false,
      antialias: true,
      ...(config?.contextAttributes ?? {}),
    },
    fallback: config?.fallback ?? 'prefer-gpu',
  }),
  probe: (context, config) => {
    const canvas = context.canvas ?? null
    if (!canvas) {
      return {
        kind: 'gpu-webgl',
        supported: false,
        context: null,
        reason: 'Canvas is required to probe WebGL backend',
      }
    }
    const attributes =
      config.contextAttributes ?? context.webgl?.contextAttributes
    const gl = canvas.getContext(
      'webgl2',
      attributes,
    ) as WebGL2RenderingContext | null
    if (!gl) {
      return {
        kind: 'gpu-webgl',
        supported: false,
        context: null,
        reason: 'WebGL2 context unavailable',
      }
    }
    return { kind: 'gpu-webgl', supported: true, context: gl }
  },
  create: (options, config, probe) => {
    if (!probe.context) {
      throw new Error('WebGL2 context was not acquired during probe')
    }
    return createWebglCanvasRenderer(options, probe.context, config)
  },
}

const resolveFallbackMode = (
  config: RendererBackendConfig,
): RendererBackendFallback => {
  if (config.type === 'cpu-2d') {
    return 'cpu-only'
  }
  return (
    (config as WebglBackendConfig | WebgpuBackendConfig).fallback ??
    'prefer-gpu'
  )
}

const buildProbeContext = (
  config: RendererBackendConfig,
  canvas: RendererBackendProbeContext['canvas'],
): RendererBackendProbeContext => {
  if (config.type === 'gpu-webgl') {
    return {
      canvas,
      webgl: {
        contextAttributes: config.contextAttributes,
      },
    }
  }
  if (config.type === 'gpu-webgpu') {
    return {
      canvas,
      webgpu: {
        deviceDescriptor: config.deviceDescriptor,
        canvasConfiguration: config.canvasConfiguration,
      },
    }
  }
  return { canvas }
}

const createWithProvider = <
  TConfig extends RendererBackendConfig,
  TResult extends RendererBackendProbeResult,
>(
  options: Parameters<CreateCanvasRenderer>[0],
  provider: RendererBackendProvider<TConfig, TResult>,
  config: TConfig,
): CanvasRenderer => {
  const probeContext = buildProbeContext(config, options.canvas)
  const probeResult = provider.probe(probeContext, config)
  if (!probeResult.supported) {
    throw new Error(
      provider.kind === 'cpu-2d'
        ? 'CPU renderer probe unexpectedly failed'
        : (probeResult.reason ?? 'Renderer backend not supported'),
    )
  }
  const renderer = provider.create(options, config, probeResult)
  setRendererBackendDataset(options.canvas, provider.kind)
  return renderer
}

export const createCanvasRenderer: CreateCanvasRenderer = (options) => {
  const requestedConfig = options.backend ?? DEFAULT_BACKEND
  switch (requestedConfig.type) {
    case 'gpu-webgl': {
      const normalizedConfig =
        webglBackendProvider.normalizeConfig(requestedConfig)
      const probeContext = buildProbeContext(normalizedConfig, options.canvas)
      const probeResult = webglBackendProvider.probe(
        probeContext,
        normalizedConfig,
      )
      if (!probeResult.supported || !probeResult.context) {
        const fallbackMode = resolveFallbackMode(requestedConfig)
        if (fallbackMode === 'require-gpu') {
          throw new Error(
            probeResult.reason ??
              'WebGL backend is not supported on this device',
          )
        }
        const normalizedCpu = cpuBackendProvider.normalizeConfig({
          type: 'cpu-2d',
        })
        return createWithProvider(options, cpuBackendProvider, normalizedCpu)
      }
      const renderer = webglBackendProvider.create(
        options,
        normalizedConfig,
        probeResult,
      )
      setRendererBackendDataset(options.canvas, 'gpu-webgl')
      return renderer
    }
    case 'gpu-webgpu': {
      /** Todo implemnent actual WebGPU backend */
      const fallbackMode = resolveFallbackMode(requestedConfig)
      if (fallbackMode === 'require-gpu') {
        throw new Error('WebGPU backend is not available yet')
      }
      return createWithProvider(options, cpuBackendProvider, {
        type: 'cpu-2d',
      })
    }
    default: {
      const normalizedConfig =
        cpuBackendProvider.normalizeConfig(requestedConfig)
      return createWithProvider(options, cpuBackendProvider, normalizedConfig)
    }
  }
}

export const detectPreferredBackend = (
  options?: DetectPreferredBackendOptions,
): RendererBackendConfig => {
  const fallback = options?.fallback ?? 'prefer-gpu'
  if (fallback === 'cpu-only') {
    return { type: 'cpu-2d' }
  }
  const canvas = options?.canvas ?? createProbeCanvas()
  if (canvas) {
    const attributes = {
      preserveDrawingBuffer: true,
      alpha: false,
      antialias: true,
      ...(options?.webgl?.contextAttributes ??
        options?.contextAttributes ??
        {}),
    }
    const gl = canvas.getContext(
      'webgl2',
      attributes,
    ) as WebGL2RenderingContext | null
    if (gl) {
      const lose = gl.getExtension('WEBGL_lose_context')
      lose?.loseContext()
      return { type: 'gpu-webgl' }
    }
  }
  return { type: 'cpu-2d' }
}

const createProbeCanvas = (): HTMLCanvasElement | null => {
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    return document.createElement('canvas')
  }
  return null
}

const resolveTimestamp = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

const mapConfiguredBackend = (
  backend: RendererBackendConfig | undefined,
): RendererBackendKind | undefined => backend?.type

const shouldIncludeMetrics = (
  current: CanvasRendererUpdateOptions['metrics'],
  next: CanvasRendererUpdateOptions['metrics'],
): boolean => {
  if (!current || !next) {
    return !!next
  }
  return (
    current.devicePixelRatio !== next.devicePixelRatio ||
    current.cell.width !== next.cell.width ||
    current.cell.height !== next.cell.height ||
    current.cell.baseline !== next.cell.baseline ||
    current.font.family !== next.font.family ||
    current.font.size !== next.font.size ||
    current.font.letterSpacing !== next.font.letterSpacing ||
    current.font.lineHeight !== next.font.lineHeight
  )
}

const shouldIncludeTheme = (
  current: CanvasRendererUpdateOptions['theme'],
  next: CanvasRendererUpdateOptions['theme'],
): boolean => current !== next

const normaliseSelection = (
  selection: TerminalSelection | null | undefined,
): TerminalSelection | null => selection ?? null

const resolveOverlays = (
  frame: RendererNextFrameMetadata,
): RendererFrameOverlays => ({
  selection:
    frame.overlays?.selection ?? frame.snapshot.selection ?? null,
  cursor: frame.overlays?.cursor ?? null,
  highlights: frame.overlays?.highlights,
  layers: frame.overlays?.layers,
})

const deriveEffectiveTheme = (
  theme: RendererTheme,
  cursor: RendererCursorDescriptor | null,
): RendererTheme => {
  if (!cursor) {
    return theme
  }

  const resolvedColor =
    cursor.color !== undefined && cursor.color !== null
      ? cursor.color
      : theme.cursor.color
  const resolvedOpacity =
    cursor.opacity !== undefined
      ? cursor.opacity
      : theme.cursor.opacity
  const resolvedShape = cursor.shape ?? theme.cursor.shape

  const cursorChanged =
    resolvedColor !== theme.cursor.color ||
    resolvedOpacity !== theme.cursor.opacity ||
    resolvedShape !== theme.cursor.shape

  if (!cursorChanged) {
    return theme
  }

  return {
    ...theme,
    cursor: {
      color: resolvedColor,
      opacity: resolvedOpacity,
      shape: resolvedShape,
    },
  }
}

const deriveEffectiveSnapshot = (
  snapshot: TerminalState,
  overlays: RendererFrameOverlays,
): TerminalState => {
  const desiredSelection = normaliseSelection(overlays.selection)
  const currentSelection = normaliseSelection(snapshot.selection)

  let nextSnapshot = snapshot

  if (!areSelectionsEqual(desiredSelection, currentSelection)) {
    nextSnapshot = {
      ...nextSnapshot,
      selection: desiredSelection,
    }
  }

  if (
    overlays.cursor &&
    typeof overlays.cursor.visible === 'boolean' &&
    overlays.cursor.visible !== snapshot.cursorVisible
  ) {
    if (nextSnapshot === snapshot) {
      nextSnapshot = { ...nextSnapshot }
    }
    nextSnapshot = {
      ...nextSnapshot,
      cursorVisible: overlays.cursor.visible,
    }
  }

  return nextSnapshot
}

const hasSelectionMutation = (
  updates?: ReadonlyArray<TerminalUpdate>,
): boolean =>
  Boolean(
    updates?.some(
      (update) =>
        update.type === 'selection-set' ||
        update.type === 'selection-update' ||
        update.type === 'selection-clear',
    ),
  )

const appendSelectionUpdate = (
  updates: ReadonlyArray<TerminalUpdate> | undefined,
  selection: TerminalSelection | null,
  previousSelection: TerminalSelection | null,
): ReadonlyArray<TerminalUpdate> => {
  let next: TerminalUpdate
  if (selection) {
    next = previousSelection
      ? { type: 'selection-update', selection }
      : { type: 'selection-set', selection }
  } else {
    next = { type: 'selection-clear' }
  }
  return updates ? [...updates, next] : [next]
}

export const createRendererSession = (
  options: CreateRendererSessionOptions,
): RendererSession => {
  const {
    canvas,
    backend,
    metrics: initialMetrics,
    theme: initialTheme,
    captureDiagnosticsFrame: initialCaptureDiagnosticsFrame,
    observers: initialObservers,
    cursorOverlayStrategy: initialCursorOverlayStrategy,
    onSelectionChange: initialSelectionCallback,
  } = options

  let renderer: CanvasRenderer | null = null
  let baseTheme: RendererTheme = initialTheme
  let currentTheme: RendererTheme = initialTheme
  let currentMetrics: RendererMetrics = initialMetrics
  let currentBackendConfig: RendererBackendConfig | undefined = backend
  let captureDiagnosticsFrame = initialCaptureDiagnosticsFrame ?? false
  let observers: RendererSessionObservers = initialObservers ?? {}
  let cursorOverlayStrategy = initialCursorOverlayStrategy
  let selectionCallback: ((selection: TerminalSelection | null) => void) | null =
    initialSelectionCallback ?? null

  let lastDiagnostics: CanvasRenderer['diagnostics'] | null = null
  let lastSnapshot: TerminalState | null = null
  let lastOverlays: RendererFrameOverlays | null = null
  let lastSelection: TerminalSelection | null = null
  let emittedSelection: TerminalSelection | null = null
  let currentBackend: RendererSessionBackend | null = null

  const emitDiagnostics = (diagnostics: CanvasRenderer['diagnostics']) => {
    observers.onDiagnostics?.(diagnostics)
  }

  const emitFrame = (frame: RendererNextFrameMetadata) => {
    observers.onFrame?.({
      backend: currentBackend,
      diagnostics: lastDiagnostics,
      timestamp: resolveTimestamp(),
      metadata: frame.metadata,
    })
  }

  const emitSelection = (selection: TerminalSelection | null) => {
    if (!selectionCallback) {
      return
    }
    if (areSelectionsEqual(selection, emittedSelection)) {
      return
    }
    emittedSelection = selection
    selectionCallback(selection)
  }

  const ensureRenderer = (
    frame: RendererNextFrameMetadata,
    effectiveSnapshot: TerminalState,
    effectiveTheme: RendererTheme,
    overlays: RendererFrameOverlays,
  ): { instance: CanvasRenderer; created: boolean } => {
    if (renderer) {
      return { instance: renderer, created: false }
    }

    const instance = createCanvasRenderer({
      canvas,
      metrics: frame.metrics,
      theme: effectiveTheme,
      snapshot: effectiveSnapshot,
      backend: currentBackendConfig,
      captureDiagnosticsFrame,
      cursorOverlayStrategy,
      onSelectionChange: (selection) => {
        lastSelection = selection
        emitSelection(selection)
      },
    })

    renderer = instance
    currentMetrics = frame.metrics
    baseTheme = frame.theme
    currentTheme = effectiveTheme
    lastDiagnostics = instance.diagnostics
    lastSnapshot = effectiveSnapshot
    lastOverlays = overlays
    lastSelection = normaliseSelection(overlays.selection)
    emitSelection(lastSelection)

    const datasetBackend = readRendererBackendDataset(canvas)
    if (datasetBackend) {
      currentBackend = datasetBackend
    } else {
      currentBackend = mapConfiguredBackend(currentBackendConfig) ?? 'custom'
    }

    return { instance, created: true }
  }

  return {
    canvas,
    get backend() {
      return currentBackend
    },
    presentFrame: (frame) => {
      const overlays = resolveOverlays(frame)
      const effectiveTheme = deriveEffectiveTheme(frame.theme, overlays.cursor ?? null)
      const effectiveSnapshot = deriveEffectiveSnapshot(frame.snapshot, overlays)

      const { instance, created } = ensureRenderer(
        frame,
        effectiveSnapshot,
        effectiveTheme,
        overlays,
      )

      let updates = frame.updates
      const selection = normaliseSelection(overlays.selection)
      const selectionChanged = !areSelectionsEqual(selection, lastSelection)
      if (selectionChanged && !hasSelectionMutation(updates)) {
        updates = appendSelectionUpdate(updates, selection, lastSelection)
      }

      const metricsChanged = shouldIncludeMetrics(currentMetrics, frame.metrics)
      const themeChanged = !created && shouldIncludeTheme(currentTheme, effectiveTheme)

      const updateOptions: CanvasRendererUpdateOptions = {
        snapshot: effectiveSnapshot,
        updates,
        ...(metricsChanged ? { metrics: frame.metrics } : {}),
        ...(themeChanged ? { theme: effectiveTheme } : {}),
      }

      if (metricsChanged) {
        currentMetrics = frame.metrics
      }

      baseTheme = frame.theme
      currentTheme = effectiveTheme
      lastOverlays = overlays

      if (!created) {
        instance.applyUpdates(updateOptions)
      }

      lastSnapshot = effectiveSnapshot
      lastDiagnostics = instance.diagnostics
      lastSelection = selection

      emitDiagnostics(instance.diagnostics)
      emitSelection(selection)

      const datasetBackend = readRendererBackendDataset(canvas)
      if (datasetBackend) {
        currentBackend = datasetBackend
      } else if (!currentBackend) {
        currentBackend = mapConfiguredBackend(currentBackendConfig) ?? 'custom'
      }

      emitFrame(frame)
    },
    configure: (configuration) => {
      const {
        metrics,
        theme,
        backend: nextBackend,
        observers: nextObservers,
      } = configuration

      if (metrics) {
        currentMetrics = metrics
      }
      if (theme) {
        baseTheme = theme
      }
      if (nextObservers) {
        observers = nextObservers
      }

      let shouldResetRenderer = false

      if (
        Object.prototype.hasOwnProperty.call(
          configuration,
          'captureDiagnosticsFrame',
        )
      ) {
        const nextCapture = configuration.captureDiagnosticsFrame
        if (
          typeof nextCapture === 'boolean' &&
          nextCapture !== captureDiagnosticsFrame
        ) {
          captureDiagnosticsFrame = nextCapture
          shouldResetRenderer = true
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(
          configuration,
          'cursorOverlayStrategy',
        )
      ) {
        if (configuration.cursorOverlayStrategy !== cursorOverlayStrategy) {
          cursorOverlayStrategy = configuration.cursorOverlayStrategy
          shouldResetRenderer = true
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(
          configuration,
          'onSelectionChange',
        )
      ) {
        selectionCallback = configuration.onSelectionChange ?? null
        emittedSelection = null
        if (selectionCallback) {
          emitSelection(lastSelection)
        }
      }

      if (nextBackend && nextBackend !== currentBackendConfig) {
        currentBackendConfig = nextBackend
        shouldResetRenderer = true
      }

      if (shouldResetRenderer) {
        renderer?.dispose()
        renderer = null
        currentBackend = null
        lastSnapshot = null
        lastOverlays = null
        lastSelection = null
        emittedSelection = null
        clearRendererBackendDataset(canvas)
        return
      }

      if (renderer && lastSnapshot) {
        const overlays = lastOverlays ?? { selection: lastSelection }
        const effectiveTheme = deriveEffectiveTheme(
          baseTheme,
          overlays.cursor ?? null,
        )
        const updateOptions: CanvasRendererUpdateOptions = {
          snapshot: lastSnapshot,
          ...(metrics ? { metrics } : {}),
          ...(theme ? { theme: effectiveTheme } : {}),
        }

        if (metrics) {
          currentMetrics = metrics
        }
        if (theme) {
          currentTheme = effectiveTheme
        }

        renderer.applyUpdates(updateOptions)
        lastDiagnostics = renderer.diagnostics
        emitDiagnostics(renderer.diagnostics)
      }
    },
    getDiagnostics: () => lastDiagnostics,
    dispose: () => {
      renderer?.dispose()
      renderer = null
      lastDiagnostics = null
      currentBackend = null
      lastSnapshot = null
      lastOverlays = null
      lastSelection = null
      emittedSelection = null
      clearRendererBackendDataset(canvas)
    },
  }
}
