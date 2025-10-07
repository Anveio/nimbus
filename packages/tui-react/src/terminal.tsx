import { forwardRef, useImperativeHandle } from 'react'
import type {
  ForwardedRef,
  JSX,
  ReactElement,
  ReactNode,
  RefAttributes,
} from 'react'
import type {
  TerminalProps,
  TerminalSessionHandle,
} from './renderer-contract'
import { useRendererRoot } from './renderer-root-context'
import { RendererSessionProvider } from './renderer-session-provider'
import { RendererSurface } from './renderer-surface'
import { useRendererSessionContext } from './renderer-session-context'

/**
 * Bridges the forwarded `TerminalSessionHandle` to the active renderer root,
 * session, and runtime exposed through context. Downstream callers can rely on
 * the handle without worrying about provisioning order.
 */
const TerminalHandleBinderInner = (
  props: { readonly children?: ReactNode },
  ref: ForwardedRef<TerminalSessionHandle>,
): JSX.Element => {
  const { children } = props
  const root = useRendererRoot()
  const { session, runtime } = useRendererSessionContext()

  useImperativeHandle(
    ref,
    () => ({
      getRendererRoot: () => root,
      getSession: () => session,
      getRuntime: () => runtime,
    }),
    [root, session, runtime],
  )

  return <>{children}</>
}

const TerminalHandleBinderBase = forwardRef(TerminalHandleBinderInner)

TerminalHandleBinderBase.displayName = 'TerminalHandleBinder'

type TerminalHandleBinderComponent = (
  props: { readonly children?: ReactNode } & RefAttributes<
    TerminalSessionHandle
  >,
) => JSX.Element

const TerminalHandleBinder = TerminalHandleBinderBase as TerminalHandleBinderComponent

/**
 * Public `<Terminal />` composer. Layers the renderer boundary, surface, and
 * session provider, then exposes the imperative handle via
 * `TerminalHandleBinder`. Keeps orchestration focused while delegating
 * responsibilities to specialised layers.
 */
const TerminalInner = (
  props: TerminalProps,
  ref: ForwardedRef<TerminalSessionHandle>,
): JSX.Element => {
  const { children, renderRootProps, ...sessionProps } = props

  return (
    <RendererSurface renderRootProps={renderRootProps}>
      <RendererSessionProvider {...sessionProps}>
        <TerminalHandleBinder ref={ref}>{children}</TerminalHandleBinder>
      </RendererSessionProvider>
    </RendererSurface>
  )
}

const TerminalBase = forwardRef(TerminalInner)

TerminalBase.displayName = 'Terminal'

type TerminalComponent =(
  props: TerminalProps &
    RefAttributes<TerminalSessionHandle>,
) => ReactElement

const Terminal = TerminalBase as TerminalComponent

export { Terminal }
