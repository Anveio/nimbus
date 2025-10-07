import { createContext, useContext } from 'react'
import type { RendererRoot } from '@mana/webgl-renderer'

const RendererRootContext = createContext<RendererRoot | null>(null)

export const RendererRootProvider = RendererRootContext.Provider

/**
 * Provides the renderer root created by `RendererSessionProvider`. Consumers can
 * rely on it being initialised and tied to the boundary’s container element.
 */
export const useRendererRoot = (): RendererRoot => {
  const root = useContext(RendererRootContext)
  if (!root) {
    throw new Error('Renderer root is not available in the current React tree.')
  }
  return root
}

export { RendererRootContext }
