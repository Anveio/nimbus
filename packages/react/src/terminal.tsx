import type { SelectionPoint, TerminalSelection } from '@nimbus/webgl-renderer'
import type {
  ForwardedRef,
  JSX,
  CompositionEvent as ReactCompositionEvent,
  ClipboardEvent as ReactClipboardEvent,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefAttributes,
} from 'react'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import type { HotkeyRendererEvent } from './hotkeys'
import { createHotkeyContext, handleTerminalHotkey } from './hotkeys'
import type { TerminalProps, TerminalSessionHandle } from './renderer-contract'
import { useRendererRoot } from './renderer-root-context'
import { useRendererSessionContext } from './renderer-session-context'
import { RendererSessionProvider } from './renderer-session-provider'
import { RendererSurface } from './renderer-surface'
import { RendererEventBridge } from './renderer-event-bridge'

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
  props: {
    readonly children?: ReactNode
  } & RefAttributes<TerminalSessionHandle>,
) => JSX.Element

const TerminalHandleBinder =
  TerminalHandleBinderBase as TerminalHandleBinderComponent

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const createCaretSelection = (
  row: number,
  startColumn: number,
  endColumn: number,
): TerminalSelection => {
  const baseTimestamp = Date.now()
  return {
    anchor: {
      row,
      column: startColumn,
      timestamp: baseTimestamp,
    },
    focus: {
      row,
      column: endColumn,
      timestamp: baseTimestamp + 1,
    },
    kind: 'normal',
    status: 'idle',
  }
}

const TerminalHotkeyBoundary = (props: {
  readonly children?: ReactNode
}): JSX.Element => {
  const { children } = props
  const { session, runtime } = useRendererSessionContext()
  const compositionStateRef = useRef({ active: false, data: '' })
  const keyboardSelectionAnchorRef = useRef<SelectionPoint | null>(null)

  const clearSelection = useCallback(() => {
    if (!session) {
      return
    }
    session.dispatch({ type: 'runtime.selection.clear' })
  }, [session])

  const performLocalErase = useCallback(
    (direction: 'backspace' | 'delete') => {
      if (!session || !runtime) {
        return false
      }

      const snapshot = runtime.snapshot
      const { selection, cursor, rows, columns, buffer } = snapshot

      if (selection && selection.kind === 'normal') {
        session.dispatch({
          type: 'runtime.selection.replace',
          selection,
          replacement: '',
        })
        return true
      }

      const cursorRow = clamp(cursor.row, 0, Math.max(0, rows - 1))
      const cursorColumn = cursor.column

      if (direction === 'backspace') {
        if (cursorColumn <= 0) {
          return false
        }
        const startColumn = clamp(cursorColumn - 1, 0, columns)
        const endColumn = clamp(cursorColumn, 0, columns)
        if (startColumn === endColumn) {
          return false
        }

        const selectionToReplace = createCaretSelection(
          cursorRow,
          startColumn,
          endColumn,
        )
        session.dispatch({
          type: 'runtime.selection.replace',
          selection: selectionToReplace,
          replacement: '',
        })
        return true
      }

      if (direction === 'delete') {
        if (cursorColumn >= columns) {
          return false
        }

        const rowBuffer = buffer[cursorRow]
        const hasContent =
          Array.isArray(rowBuffer) &&
          Boolean(
            rowBuffer[cursorColumn] && rowBuffer[cursorColumn]!.char !== ' ',
          )

        if (!hasContent) {
          return false
        }

        const startColumn = clamp(cursorColumn, 0, columns)
        const endColumn = clamp(cursorColumn + 1, 0, columns)
        if (startColumn === endColumn) {
          return false
        }

        const selectionToReplace = createCaretSelection(
          cursorRow,
          startColumn,
          endColumn,
        )
        session.dispatch({
          type: 'runtime.selection.replace',
          selection: selectionToReplace,
          replacement: '',
        })
        return true
      }

      return false
    },
    [runtime, session],
  )
  const toggleShortcutGuide = useCallback(() => {}, [])

  const hotkeyContext = useMemo(() => {
    if (!runtime) {
      return null
    }
    return createHotkeyContext({
      runtime,
      performLocalErase,
      clearSelection,
      toggleShortcutGuide,
      shortcutGuideEnabled: false,
      compositionStateRef,
      keyboardSelectionAnchorRef,
    })
  }, [runtime, performLocalErase, clearSelection, toggleShortcutGuide])

  const dispatchRendererEvents = useCallback(
    (events: readonly HotkeyRendererEvent[]) => {
      if (!session) {
        return
      }
      for (const rendererEvent of events) {
        session.dispatch(rendererEvent)
      }
    },
    [session],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!hotkeyContext || !runtime || !session) {
        return
      }
      const result = handleTerminalHotkey(event, hotkeyContext)
      if (!result.handled) {
        return
      }
      if (result.preventDefault) {
        event.preventDefault()
        event.stopPropagation()
      }
      if (result.rendererEvents) {
        dispatchRendererEvents(result.rendererEvents)
      }
    },
    [dispatchRendererEvents, hotkeyContext, runtime, session],
  )

  const handleCompositionStart = useCallback(
    (event: ReactCompositionEvent<HTMLDivElement>) => {
      compositionStateRef.current.active = true
      compositionStateRef.current.data = event.data ?? ''
    },
    [],
  )

  const handleCompositionUpdate = useCallback(
    (event: ReactCompositionEvent<HTMLDivElement>) => {
      compositionStateRef.current.data = event.data ?? ''
    },
    [],
  )

  const handleCompositionEnd = useCallback(
    (event: ReactCompositionEvent<HTMLDivElement>) => {
      compositionStateRef.current.active = false
      compositionStateRef.current.data = ''
      if (!session) {
        return
      }
      if (event.data) {
        session.dispatch({ type: 'runtime.text', value: event.data })
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [session],
  )

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!session) {
        return
      }
      const text = event.clipboardData?.getData('text') ?? ''
      if (text.length === 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      session.dispatch({ type: 'runtime.paste', text })
    },
    [session],
  )

  return (
    <div
      data-testid="terminal-hotkeys-boundary"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: It is interactive
      tabIndex={0}
      role="application"
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionUpdate={handleCompositionUpdate}
      onCompositionEnd={handleCompositionEnd}
      onPaste={handlePaste}
    >
      {children}
    </div>
  )
}

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
        <RendererEventBridge />
        <TerminalHotkeyBoundary>
          <TerminalHandleBinder ref={ref}>{children}</TerminalHandleBinder>
        </TerminalHotkeyBoundary>
      </RendererSessionProvider>
    </RendererSurface>
  )
}

const TerminalBase = forwardRef(TerminalInner)

TerminalBase.displayName = 'Terminal'

type TerminalComponent = (
  props: TerminalProps & RefAttributes<TerminalSessionHandle>,
) => ReactElement

const Terminal = TerminalBase as TerminalComponent

export { Terminal }
