import type { RendererRootContainer } from '@nimbus/webgl-renderer'
import type {
  CanvasHTMLAttributes,
  ForwardedRef,
  ReactNode,
  RefAttributes,
} from 'react'
import { forwardRef, useCallback, useMemo, useState } from 'react'
import {
  RendererSurfaceContextProvider,
  useRendererSurface,
} from './renderer-surface-context'

const assignRef = <T,>(ref: ForwardedRef<T> | undefined, value: T | null) => {
  if (!ref) {
    return
  }
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ;(ref as { current: T | null }).current = value
}

export interface RendererSurfaceProps {
  readonly renderRoot?: RendererRootContainer
  readonly renderRootProps?: CanvasHTMLAttributes<HTMLCanvasElement>
  readonly children?: ReactNode
}

/**
 * Guarantees a render root element (managed `<canvas>` or supplied instance)
 * exists before renderer sessions mount. Children render only once the element
 * is ready, so downstream hooks can safely access it through context.
 */
const RendererSurfaceInner = (
  props: RendererSurfaceProps,
  ref: ForwardedRef<HTMLCanvasElement>,
): ReactNode => {
  const { renderRoot: providedRenderRoot, renderRootProps, children } = props

  const [managedRenderRoot, setManagedRenderRoot] =
    useState<RendererRootContainer | null>(providedRenderRoot ?? null)

  const handleRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (providedRenderRoot) {
        assignRef(ref, node)
        return
      }
      setManagedRenderRoot(node)
      assignRef(ref, node)
    },
    [providedRenderRoot, ref],
  )

  const contextValue = useMemo(
    () => ({ renderRoot: providedRenderRoot ?? managedRenderRoot }),
    [providedRenderRoot, managedRenderRoot],
  )

  const shouldRenderChildren = Boolean(contextValue.renderRoot)

  return (
    <RendererSurfaceContextProvider value={contextValue}>
      {providedRenderRoot ? null : (
        <canvas {...renderRootProps} ref={handleRef} />
      )}
      {shouldRenderChildren ? children : null}
    </RendererSurfaceContextProvider>
  )
}

const RendererSurfaceBase = forwardRef(RendererSurfaceInner)

RendererSurfaceBase.displayName = 'RendererSurface'

export const RendererSurface = RendererSurfaceBase as (
  props: RendererSurfaceProps & RefAttributes<HTMLCanvasElement>,
) => ReactNode

export const useRendererSurfaceRoot = useRendererSurface
