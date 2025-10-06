import { forwardRef, useImperativeHandle } from 'react'
import type {
  ForwardedRef,
  JSX,
  ReactElement,
  ReactNode,
  RefAttributes,
} from 'react'
import type {
  RendererSessionProviderProps,
  TerminalProps,
  TerminalSessionHandle,
} from './renderer-contract'
import { RendererRootBoundary } from './renderer-root-boundary'
import { useRendererRoot } from './renderer-root-context'
import { RendererSessionProvider } from './renderer-session-provider'
import { useRendererSessionContext } from './renderer-session-context'
import type { WebglRendererConfig } from '@mana/webgl-renderer'

const TerminalHandleBinderInner = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: { readonly children?: ReactNode },
  ref: ForwardedRef<TerminalSessionHandle<TRendererConfig>>,
): JSX.Element => {
  const { children } = props
  const root = useRendererRoot<TRendererConfig>()
  const { session, runtime } = useRendererSessionContext<TRendererConfig>()

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

type TerminalHandleBinderComponent = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: { readonly children?: ReactNode } & RefAttributes<
    TerminalSessionHandle<TRendererConfig>
  >,
) => JSX.Element

const TerminalHandleBinder = TerminalHandleBinderBase as TerminalHandleBinderComponent

const TerminalInner = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: TerminalProps<TRendererConfig>,
  ref: ForwardedRef<TerminalSessionHandle<TRendererConfig>>,
): JSX.Element => {
  const {
    rendererFactory,
    containerProps,
    children,
    ...sessionProps
  } = props

  const sessionProviderProps = sessionProps as RendererSessionProviderProps<TRendererConfig>

  return (
    <RendererRootBoundary
      rendererFactory={rendererFactory}
      containerProps={containerProps}
    >
      <RendererSessionProvider {...sessionProviderProps}>
        <TerminalHandleBinder ref={ref}>{children}</TerminalHandleBinder>
      </RendererSessionProvider>
    </RendererRootBoundary>
  )
}

const TerminalBase = forwardRef(TerminalInner)

TerminalBase.displayName = 'Terminal'

type TerminalComponent = <
  TRendererConfig extends { renderRoot?: unknown } = WebglRendererConfig,
>(
  props: TerminalProps<TRendererConfig> &
    RefAttributes<TerminalSessionHandle<TRendererConfig>>,
) => ReactElement

const Terminal = TerminalBase as TerminalComponent

export { Terminal }
