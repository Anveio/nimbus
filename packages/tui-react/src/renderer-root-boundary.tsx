import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import type { ForwardedRef, ReactNode } from 'react'
import {
  createRendererRoot,
  type RendererRoot,
  type WebglRendererConfig,
} from '@mana/webgl-renderer'
import type {
  TerminalManagedContainerProps,
  TerminalRendererFactory,
} from './renderer-contract'
import { RendererRootProvider } from './renderer-root-context'

export interface RendererRootBoundaryProps<
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
> {
  readonly rendererFactory?: TerminalRendererFactory<TRendererConfig>
  readonly containerProps?: TerminalManagedContainerProps
  readonly children?: ReactNode
}

const RendererRootBoundaryInner = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: RendererRootBoundaryProps<TRendererConfig>,
  ref: ForwardedRef<HTMLDivElement>,
) => {
  const { rendererFactory, containerProps, children } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [renderRoot, setRenderRoot] = useState<RendererRoot<TRendererConfig> | null>(
    null,
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const factory = rendererFactory ?? (createRendererRoot as TerminalRendererFactory<TRendererConfig>)
    const root = factory(container)
    setRenderRoot(root)

    return () => {
      root.dispose()
    }
  }, [rendererFactory])

  return (
    <div
      {...containerProps}
      ref={(node) => {
        containerRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ;(ref as { current: HTMLDivElement | null }).current = node
        }
      }}
    >
      {renderRoot ? (
        <RendererRootProvider value={renderRoot}>{children}</RendererRootProvider>
      ) : null}
    </div>
  )
}

export const RendererRootBoundary = forwardRef(RendererRootBoundaryInner)

RendererRootBoundary.displayName = 'RendererRootBoundary'
