import { createCpuCanvasRenderer } from './backends/canvas/cpu'
import { createWebglCanvasRenderer } from './backends/webgl/renderer'
import type {
  CanvasRenderer,
  Cpu2dBackendConfig,
  CreateCanvasRenderer,
  DetectPreferredBackendOptions,
  RendererBackendConfig,
  RendererBackendFallback,
  RendererBackendProbeContext,
  RendererBackendProbeResult,
  RendererBackendProvider,
  WebglBackendConfig,
  WebgpuBackendConfig,
  WebglBackendProbeResult,
} from './types'

export * from './types'

const DEFAULT_BACKEND: RendererBackendConfig = { type: 'cpu-2d' }

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
  matches: (config): config is WebglBackendConfig => config.type === 'gpu-webgl',
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
    const attributes = config.contextAttributes ?? context.webgl?.contextAttributes
    const gl = canvas.getContext('webgl2', attributes) as
      | WebGL2RenderingContext
      | null
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
  return provider.create(options, config, probeResult)
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
            probeResult.reason ?? 'WebGL backend is not supported on this device',
          )
        }
        const normalizedCpu = cpuBackendProvider.normalizeConfig({ type: 'cpu-2d' })
        return createWithProvider(options, cpuBackendProvider, normalizedCpu)
      }
      return webglBackendProvider.create(options, normalizedConfig, probeResult)
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
      ...(options?.webgl?.contextAttributes ?? options?.contextAttributes ?? {}),
    }
    const gl = canvas.getContext('webgl2', attributes) as
      | WebGL2RenderingContext
      | null
    if (gl) {
      const lose = gl.getExtension('WEBGL_lose_context')
      lose?.loseContext()
      return { type: 'gpu-webgl' }
    }
  }
  return { type: 'cpu-2d' }
}

const createProbeCanvas = (): HTMLCanvasElement | null => {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return document.createElement('canvas')
  }
  return null
}
