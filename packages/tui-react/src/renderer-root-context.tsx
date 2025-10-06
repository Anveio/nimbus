import { createContext, useContext } from 'react'
import type { RendererRoot, WebglRendererConfig } from '@mana/webgl-renderer'

const RendererRootContext = createContext<RendererRoot | null>(null)

export const RendererRootProvider = RendererRootContext.Provider

/**
 * Provides the renderer root created by `RendererRootBoundary`. Consumers can
 * rely on it being initialised and tied to the boundary’s container element.
 */
export const useRendererRoot = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
): RendererRoot => {
  const root = useContext(RendererRootContext)
  if (!root) {
    throw new Error('Renderer root is not available in the current React tree.')
  }
  return root as RendererRoot
}

export { RendererRootContext }
