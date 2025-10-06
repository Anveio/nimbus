import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import type { ForwardedRef, ReactNode } from 'react'
import {
  createRendererRoot,
  type RendererRoot,
  type WebglRendererConfig,
} from '@mana/webgl-renderer'
import type {
  TerminalRendererFactory,
} from './renderer-contract'
import { RendererRootProvider } from './renderer-root-context'

export interface RendererRootBoundaryProps {
  readonly rendererFactory?: TerminalRendererFactory
  readonly children?: ReactNode
}

/**
 * Ensures a host container element exists before creating a renderer root.
 * The boundary owns the outer `<div>` and publishes the resulting
 * `RendererRoot` via context so deeper layers can safely mount sessions.
 */
const RendererRootBoundaryInner = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: RendererRootBoundaryProps,
  ref: ForwardedRef<HTMLDivElement>,
) => {
  const { rendererFactory, children } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [renderRoot, setRenderRoot] = useState<RendererRoot | null>(
    null,
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const factory = rendererFactory ?? createRendererRoot
    const root = factory(container)
    setRenderRoot(root)

    return () => {
      root.dispose()
    }
  }, [rendererFactory])

  return (renderRoot ? (
        <RendererRootProvider value={renderRoot}>{children}</RendererRootProvider>
      ) : null
  )
}

export const RendererRootBoundary = forwardRef(RendererRootBoundaryInner)

RendererRootBoundary.displayName = 'RendererRootBoundary'
