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
  WebglRendererSession,
} from '@mana/webgl-renderer'
import type {
  CanvasHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'

export type TerminalRendererFactory = (
  container: RendererRootContainer,
  options: WebglRendererRootOptions,
) => RendererRoot<WebglRendererConfig>

export interface TerminalConfigurationContext {
  readonly container: RendererRootContainer
}

export type TerminalConfigurationStrategy = (
  context: TerminalConfigurationContext,
) => RendererConfiguration

export interface TerminalSessionHandle {
  getRendererRoot(): RendererRoot | null
  getSession(): RendererSession | null
  getRuntime(): WebglRendererSession['runtime'] | null
}

export interface RendererSessionProviderProps{
  readonly rendererFactory?: TerminalRendererFactory
  readonly rendererConfig?: Partial<WebglRendererConfig>
  readonly runtime?: WebglRendererSession['runtime']
  readonly profile?: TerminalProfile
  readonly deriveConfiguration: TerminalConfigurationStrategy
  readonly onFrame?: (event: RendererFrameEvent) => void
  readonly onResizeRequest?: (event: RendererResizeRequestEvent) => void
  readonly children?: ReactNode
}

export interface TerminalProps extends RendererSessionProviderProps {
  readonly rendererFactory?: TerminalRendererFactory
  readonly renderRootProps?: CanvasHTMLAttributes<HTMLCanvasElement>
}
