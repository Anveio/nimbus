import type {
  RenderSurface,
  RendererConfiguration,
  RendererFrameEvent,
  RendererResizeRequestEvent,
  RendererRoot,
  RendererRootContainer,
  RendererSession,
  TerminalProfile,
  WebglRendererConfig,
  WebglRendererSession,
} from '@mana/webgl-renderer'
import type {
  CanvasHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'

export type TerminalRendererFactory = (container: HTMLElement) => RendererRoot

export interface TerminalSurfaceContext {
  readonly renderRoot: RendererRootContainer
  readonly rendererConfig?: Partial<WebglRendererConfig>
}

export type TerminalSurfaceStrategy = (
  context: TerminalSurfaceContext,
) => RenderSurface

export interface TerminalConfigurationContext{
  readonly container: HTMLElement
  readonly surface: RenderSurface
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
  readonly rendererConfig?: Partial<WebglRendererConfig>
  readonly runtime?: WebglRendererSession['runtime']
  readonly profile?: TerminalProfile
  readonly deriveConfiguration: TerminalConfigurationStrategy
  readonly surface?: TerminalSurfaceStrategy
  readonly onFrame?: (event: RendererFrameEvent) => void
  readonly onResizeRequest?: (event: RendererResizeRequestEvent) => void
  readonly children?: ReactNode
}

export interface TerminalProps extends RendererSessionProviderProps {
  readonly rendererFactory?: TerminalRendererFactory
  readonly renderRootProps?: CanvasHTMLAttributes<HTMLCanvasElement>
}
