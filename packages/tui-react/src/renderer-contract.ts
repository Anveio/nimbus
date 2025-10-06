import type {
  RenderSurface,
  RendererConfiguration,
  RendererFrameEvent,
  RendererResizeRequestEvent,
  RendererRoot,
  RendererSession,
  TerminalProfile,
  WebglRendererConfig,
} from '@mana/webgl-renderer'
import type { TerminalRuntime } from '@mana/vt'
import type { HTMLAttributes, ReactNode } from 'react'

export type TerminalRendererFactory<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> = (container: HTMLElement) => RendererRoot<TRendererConfig>

export type TerminalManagedContainerProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'dangerouslySetInnerHTML'
>

export interface TerminalSurfaceContext<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  readonly container: HTMLElement
  readonly rendererConfig?: Partial<TRendererConfig>
}

export type TerminalSurfaceStrategy<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> = (
  context: TerminalSurfaceContext<TRendererConfig>,
) => RenderSurface<TRendererConfig>

export interface TerminalConfigurationContext<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  readonly container: HTMLElement
  readonly surface: RenderSurface<TRendererConfig>
}

export type TerminalConfigurationStrategy<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> = (
  context: TerminalConfigurationContext<TRendererConfig>,
) => RendererConfiguration

export interface TerminalSessionHandle<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  getRendererRoot(): RendererRoot<TRendererConfig> | null
  getSession(): RendererSession<TRendererConfig> | null
  getRuntime(): TerminalRuntime | null
}

export interface RendererSessionProviderProps<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  readonly rendererConfig?: Partial<TRendererConfig>
  readonly runtime?: TerminalRuntime
  readonly profile?: TerminalProfile
  readonly deriveConfiguration: TerminalConfigurationStrategy<TRendererConfig>
  readonly surface?: TerminalSurfaceStrategy<TRendererConfig>
  readonly onFrame?: (event: RendererFrameEvent) => void
  readonly onResizeRequest?: (event: RendererResizeRequestEvent) => void
  readonly children?: ReactNode
}

export interface TerminalProps<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> extends RendererSessionProviderProps<TRendererConfig> {
  readonly rendererFactory?: TerminalRendererFactory<TRendererConfig>
  readonly containerProps?: TerminalManagedContainerProps
}
