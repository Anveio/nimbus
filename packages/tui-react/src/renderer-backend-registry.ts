import type {
  RendererConfiguration,
  RendererRoot,
  RendererRootContainer,
  RendererSession,
  TerminalProfile,
} from '@nimbus/webgl-renderer'
import type { TerminalRuntime } from '@nimbus/vt'

export interface RendererBackendMountContext<TConfig = unknown> {
  readonly canvas: RendererRootContainer
  readonly configuration: RendererConfiguration
  readonly runtime: TerminalRuntime
  readonly profile?: TerminalProfile
  readonly rendererConfig: TConfig | undefined
}

export interface MountedRendererSession {
  readonly root: RendererRoot
  readonly session: RendererSession
}

export interface RendererBackendRegistration<TConfig = unknown> {
  createRuntime(config: TConfig | undefined): TerminalRuntime
  mount(context: RendererBackendMountContext<TConfig>): MountedRendererSession
}

const backendRegistry = new Map<string, RendererBackendRegistration<any>>()
let defaultBackendKey = 'webgl'

export const registerRendererBackend = <TConfig = unknown>(
  key: string,
  registration: RendererBackendRegistration<TConfig>,
): void => {
  backendRegistry.set(key, registration)
}

export const setDefaultRendererBackend = (key: string): void => {
  defaultBackendKey = key
}

export const getDefaultRendererBackendKey = (): string => defaultBackendKey

export const getRendererBackend = (
  key: string,
): RendererBackendRegistration<any> | undefined => {
  return backendRegistry.get(key)
}

export const hasRendererBackend = (key: string): boolean =>
  backendRegistry.has(key)

export const clearRendererBackendsForTests = (): void => {
  backendRegistry.clear()
  defaultBackendKey = 'webgl'
}
