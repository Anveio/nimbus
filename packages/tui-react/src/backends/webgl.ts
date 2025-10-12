import type { TerminalRuntime } from '@nimbus/vt'
import {
  createRendererRoot,
  createTerminalRuntime,
  type RendererRoot,
  type RendererSession,
  type TerminalProfile,
  type WebglRendererConfig,
  type WebglRendererRootOptions,
} from '@nimbus/webgl-renderer'
import {
  getRendererBackend,
  hasRendererBackend,
  type MountedRendererSession,
  type RendererBackendMountContext,
  type RendererBackendRegistration,
  registerRendererBackend,
} from '../renderer-backend-registry'

const WEBGL_BACKEND_KEY = 'webgl'

type WebglRendererConfigInput = Partial<WebglRendererConfig> & {
  readonly runtime?: TerminalRuntime | null
  readonly profile?: TerminalProfile
}

const resolveConfig = (config: unknown): WebglRendererConfigInput => {
  if (config && typeof config === 'object') {
    return config as WebglRendererConfigInput
  }
  return {}
}

const createRuntimeFromConfig = (
  config: WebglRendererConfigInput,
): TerminalRuntime => {
  if (config.runtime) {
    return config.runtime
  }
  return createTerminalRuntime()
}

const mountWebglRenderer = (
  context: RendererBackendMountContext,
): MountedRendererSession => {
  const config = resolveConfig(context.rendererConfig)
  const rootOptions: WebglRendererRootOptions = {
    ...config,
    configuration: context.configuration,
    runtime: context.runtime,
    ...(context.profile !== undefined ? { profile: context.profile } : {}),
  }

  const root: RendererRoot = createRendererRoot(context.canvas, rootOptions)
  const session: RendererSession = root.mount()

  if (context.profile !== undefined && config.profile === undefined) {
    session.dispatch({
      type: 'profile.update',
      profile: context.profile,
    })
  }

  return { root, session }
}

const webglRegistration: RendererBackendRegistration = {
  createRuntime(config) {
    return createRuntimeFromConfig(resolveConfig(config))
  },
  mount(context) {
    return mountWebglRenderer(context)
  },
}

export const registerWebglRendererBackend = (): void => {
  registerRendererBackend(WEBGL_BACKEND_KEY, webglRegistration)
}

if (!hasRendererBackend(WEBGL_BACKEND_KEY)) {
  registerWebglRendererBackend()
}

export const resolveDefaultRendererBackend = () =>
  getRendererBackend(WEBGL_BACKEND_KEY)
