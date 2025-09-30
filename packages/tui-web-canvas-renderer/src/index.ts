import type {
  CreateCanvasRenderer,
  DetectPreferredBackendOptions,
  RendererBackendConfig,
  RendererBackendFallback,
  WebglBackendConfig,
} from './types'
import { createCpuCanvasRenderer } from './backends/cpu'
import {
  detectWebglSupport as detectWebglSupportInternal,
  tryCreateWebglCanvasRenderer,
} from './backends/gpu-webgl'

export * from './types'
export { detectWebglSupportInternal as detectWebglSupport }
export type {
  WebglSupportOptions,
  WebglSupportResult,
  WebglInitOutcome,
} from './backends/gpu-webgl'

const DEFAULT_BACKEND: RendererBackendConfig = { type: 'cpu-2d' }

const isWebglBackendConfig = (
  config: RendererBackendConfig,
): config is WebglBackendConfig => config.type === 'gpu-webgl'

const resolveFallbackMode = (config: WebglBackendConfig): RendererBackendFallback =>
  config.fallback ?? 'prefer-gpu'

const resolveBackendConfig = (
  config: RendererBackendConfig | undefined,
): RendererBackendConfig => config ?? DEFAULT_BACKEND

export const createCanvasRenderer: CreateCanvasRenderer = (options) => {
  const backendConfig = resolveBackendConfig(options.backend)

  if (isWebglBackendConfig(backendConfig)) {
    const fallbackMode = resolveFallbackMode(backendConfig)
    if (fallbackMode === 'cpu-only') {
      return createCpuCanvasRenderer({
        ...options,
        backend: { type: 'cpu-2d' },
      })
    }
    const outcome = tryCreateWebglCanvasRenderer(options, backendConfig)

    if (outcome.success) {
      return outcome.renderer
    }

    if (fallbackMode === 'require-gpu') {
      throw new Error(
        `WebGL renderer initialisation failed: ${
          outcome.reason ?? 'unknown reason'
        }`,
      )
    }
  }

  return createCpuCanvasRenderer({ ...options, backend: { type: 'cpu-2d' } })
}

export const detectPreferredBackend = (
  options?: DetectPreferredBackendOptions,
): RendererBackendConfig => {
  const fallback = options?.fallback ?? 'prefer-gpu'
  if (fallback === 'cpu-only') {
    return { type: 'cpu-2d' }
  }
  const support = detectWebglSupportInternal({
    canvas: options?.canvas,
    contextAttributes: options?.contextAttributes,
  })

  if (support.supported) {
    return {
      type: 'gpu-webgl',
      contextAttributes: options?.contextAttributes,
      fallback,
    }
  }

  return { type: 'cpu-2d' }
}
