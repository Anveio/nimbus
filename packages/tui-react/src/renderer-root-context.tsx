import { createContext, useContext } from 'react'
import type { RendererRoot, WebglRendererConfig } from '@mana/webgl-renderer'

type GenericRendererRoot = RendererRoot<{ renderRoot?: unknown }>

const RendererRootContext = createContext<GenericRendererRoot | null>(null)

export const RendererRootProvider = RendererRootContext.Provider

export const useRendererRoot = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
): RendererRoot<TRendererConfig> => {
  const root = useContext(RendererRootContext)
  if (!root) {
    throw new Error('Renderer root is not available in the current React tree.')
  }
  return root as RendererRoot<TRendererConfig>
}

export type { GenericRendererRoot }
export { RendererRootContext }
