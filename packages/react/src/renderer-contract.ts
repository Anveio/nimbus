import type {
  RendererFrameEvent,
  RendererResizeRequestEvent,
  RendererRoot,
  RendererSession,
  TerminalRuntimeResponse,
  WebglRendererSession,
} from '@nimbus/webgl-renderer'
import type { CanvasHTMLAttributes, ReactNode } from 'react'

export interface TerminalSessionHandle {
  getRendererRoot(): RendererRoot | null
  getSession(): RendererSession | null
  getRuntime(): WebglRendererSession['runtime'] | null
}

export interface RendererSessionProviderProps {
  readonly rendererBackend?: string
  readonly rendererConfig?: unknown
  readonly onFrame?: (event: RendererFrameEvent) => void
  readonly onResizeRequest?: (event: RendererResizeRequestEvent) => void
  readonly onRuntimeResponse?: (response: TerminalRuntimeResponse) => void
  readonly children?: ReactNode
}

export interface TerminalProps extends RendererSessionProviderProps {
  readonly renderRootProps?: CanvasHTMLAttributes<HTMLCanvasElement>
}
