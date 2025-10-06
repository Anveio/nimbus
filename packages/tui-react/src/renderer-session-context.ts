import { createContext, useContext } from 'react'
import type {
  RendererSession,
  WebglRendererConfig,
} from '@mana/webgl-renderer'
import type { TerminalRuntime } from '@mana/vt'

export interface RendererSessionContextValue<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  readonly session: RendererSession<TRendererConfig> | null
  readonly runtime: TerminalRuntime | null
}

const RendererSessionContext = createContext<RendererSessionContextValue>(
  Object.freeze({ session: null, runtime: null }),
)

export const RendererSessionContextProvider = RendererSessionContext.Provider

export const useRendererSessionContext = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(): RendererSessionContextValue<TRendererConfig> => {
  return useContext(RendererSessionContext) as RendererSessionContextValue<TRendererConfig>
}
