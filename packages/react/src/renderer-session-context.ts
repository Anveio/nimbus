import type { RendererSession, TerminalRuntime } from '@nimbus/webgl-renderer'
import { createContext, useContext } from 'react'

export interface RendererSessionContextValue {
  readonly session: RendererSession | null
  readonly runtime: TerminalRuntime | null
}

const RendererSessionContext = createContext<RendererSessionContextValue>(
  Object.freeze({ session: null, runtime: null }),
)

export const RendererSessionContextProvider = RendererSessionContext.Provider

/**
 * Exposes the active renderer session and runtime provisioned by
 * `RendererSessionProvider`. Using the hook outside that provider signals a
 * layering error, so callers always receive non-stale handles.
 */
export const useRendererSessionContext = (): RendererSessionContextValue => {
  return useContext(RendererSessionContext)
}
