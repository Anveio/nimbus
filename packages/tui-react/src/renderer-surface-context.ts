import { createContext, useContext } from 'react'
import type { RendererRootContainer } from '@nimbus/webgl-renderer'

interface RendererSurfaceContextValue {
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
export const useRendererSurface = (): RendererRootContainer => {
  const context = useContext(RendererSurfaceContext)
  if (!context.renderRoot) {
    throw new Error('Renderer surface is not available in the current React tree.')
  }
  return context.renderRoot
}
