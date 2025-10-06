import { createContext, useContext } from 'react'
import type {
  RendererRootContainer,
  WebglRendererConfig,
} from '@mana/webgl-renderer'

interface RendererSurfaceContextValue<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  readonly renderRoot: RendererRootContainer | null
}

const DEFAULT_VALUE: RendererSurfaceContextValue = Object.freeze({
  renderRoot: null,
})

const RendererSurfaceContext =
  createContext<RendererSurfaceContextValue>(DEFAULT_VALUE)

export const RendererSurfaceContextProvider = RendererSurfaceContext.Provider

/**
 * Returns the concrete render root element guaranteed by `RendererSurface`.
 * Throws when accessed outside the surface boundary so consumers never act on
 * a `null` canvas.
 */
export const useRendererSurface = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(): RendererRootContainer => {
  const context = useContext(RendererSurfaceContext) as RendererSurfaceContextValue<TRendererConfig>
  if (!context.renderRoot) {
    throw new Error('Renderer surface is not available in the current React tree.')
  }
  return context.renderRoot
}
