import { createCpuCanvasRenderer } from './backends/canvas/cpu'
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
      /** Todo implemnent actual WebGL backend */
      return createWithProvider(options, cpuBackendProvider, {
        type: 'cpu-2d',
      })
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

  return { type: 'cpu-2d' }
}
