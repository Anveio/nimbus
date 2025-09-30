import type {
  CanvasRenderer,
  CreateCanvasRenderer,
  DetectPreferredBackendOptions,
  RendererBackendConfig,
  RendererBackendFallback,
  RendererBackendProbeContext,
  RendererBackendProbeResult,
  RendererBackendProvider,
  Cpu2dBackendConfig,
  WebglBackendConfig,
  WebgpuBackendConfig,
} from './types'
import { createCpuCanvasRenderer } from './backends/cpu'
import {
  createWebglBackendProvider,
  detectWebglSupport as detectWebglSupportInternal,
} from './backends/gpu-webgl'

export * from './types'
export { detectWebglSupportInternal as detectWebglSupport }
export type {
  WebglSupportOptions,
  WebglSupportResult,
  WebglInitOutcome,
} from './backends/gpu-webgl'

const DEFAULT_BACKEND: RendererBackendConfig = { type: 'cpu-2d' }

const cpuBackendProvider: RendererBackendProvider<Cpu2dBackendConfig> = {
  kind: 'cpu-2d',
  matches: (config): config is Cpu2dBackendConfig => config.type === 'cpu-2d',
  normalizeConfig: (_config) => ({ type: 'cpu-2d' }),
  probe: (_context, _config) => ({ kind: 'cpu-2d', supported: true }),
  create: (
    options,
    _config,
    _probe,
  ) => createCpuCanvasRenderer({ ...options, backend: { type: 'cpu-2d' } }),
}

const webglBackendProvider = createWebglBackendProvider()

const resolveFallbackMode = (
  config: RendererBackendConfig,
): RendererBackendFallback => {
  if (config.type === 'cpu-2d') {
    return 'cpu-only'
  }
  return (config as WebglBackendConfig | WebgpuBackendConfig).fallback ?? 'prefer-gpu'
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
        : probeResult.reason ?? 'Renderer backend not supported',
    )
  }
  return provider.create(options, config, probeResult)
}

export const createCanvasRenderer: CreateCanvasRenderer = (options) => {
  const requestedConfig = options.backend ?? DEFAULT_BACKEND
  switch (requestedConfig.type) {
    case 'gpu-webgl': {
      const normalizedConfig = webglBackendProvider.normalizeConfig(
        requestedConfig,
      )
      const fallbackMode = resolveFallbackMode(normalizedConfig)

      if (fallbackMode === 'cpu-only') {
        return createWithProvider(options, cpuBackendProvider, {
          type: 'cpu-2d',
        })
      }

      try {
        return createWithProvider(options, webglBackendProvider, normalizedConfig)
      } catch (error) {
        if (fallbackMode === 'require-gpu') {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`GPU renderer initialisation failed: ${reason}`)
        }
      }

      return createWithProvider(options, cpuBackendProvider, {
        type: 'cpu-2d',
      })
    }
    case 'gpu-webgpu': {
      const fallbackMode = resolveFallbackMode(requestedConfig)
      if (fallbackMode === 'require-gpu') {
        throw new Error('WebGPU backend is not available yet')
      }
      return createWithProvider(options, cpuBackendProvider, {
        type: 'cpu-2d',
      })
    }
    case 'cpu-2d':
    default: {
      const normalizedConfig = cpuBackendProvider.normalizeConfig(
        requestedConfig,
      )
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

  const webglConfig = webglBackendProvider.normalizeConfig({
    type: 'gpu-webgl',
    fallback,
    contextAttributes:
      options?.webgl?.contextAttributes ?? options?.contextAttributes,
  })

  const probeContext: RendererBackendProbeContext = {
    canvas: options?.canvas,
    webgl: {
      contextAttributes:
        options?.webgl?.contextAttributes ?? webglConfig.contextAttributes,
    },
  }

  const support = webglBackendProvider.probe(probeContext, webglConfig)

  if (support.supported) {
    return webglConfig
  }

  return { type: 'cpu-2d' }
}
