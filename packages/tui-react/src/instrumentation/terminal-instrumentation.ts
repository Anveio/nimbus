import type { TerminalSelection } from '@mana/vt'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  TerminalRendererHandle,
  TerminalRendererFrameEvent,
} from '../renderer'

export interface TerminalFrameEvent extends TerminalRendererFrameEvent {}

export type TerminalErrorSource = 'renderer' | 'terminal'

export interface TerminalErrorEvent {
  readonly source: TerminalErrorSource
  readonly error: Error
  readonly context?: Record<string, unknown>
}

export interface TerminalInstrumentationOptions {
  readonly onData?: (data: Uint8Array) => void
  readonly onDiagnostics?: (
    diagnostics: TerminalRendererHandle['diagnostics'],
  ) => void
  readonly onFrame?: (event: TerminalFrameEvent) => void
  readonly onCursorSelectionChange?: (
    selection: TerminalSelection | null,
  ) => void
  readonly onError?: (event: TerminalErrorEvent) => void
}

interface ResolvedInstrumentationOptions {
  readonly onData?: (data: Uint8Array) => void
  readonly onDiagnostics?: (
    diagnostics: TerminalRendererHandle['diagnostics'],
  ) => void
  readonly onFrame?: (event: TerminalFrameEvent) => void
  readonly onCursorSelectionChange?: (
    selection: TerminalSelection | null,
  ) => void
  readonly onError?: (event: TerminalErrorEvent) => void
}

export interface TerminalInstrumentationHandle {
  readonly hasExternalDataConsumer: boolean
  readonly emitData: (payload: Uint8Array) => void
  readonly emitDiagnostics: (
    diagnostics: TerminalRendererHandle['diagnostics'],
  ) => void
  readonly emitFrame: (event: TerminalFrameEvent) => void
  readonly emitSelectionChange: (selection: TerminalSelection | null) => void
  readonly emitError: (event: TerminalErrorEvent) => void
}

export const useTerminalInstrumentation = (
  options: TerminalInstrumentationOptions | null | undefined,
): TerminalInstrumentationHandle => {
  const resolved = useMemo<ResolvedInstrumentationOptions>(() => {
    return {
      onData: options?.onData,
      onDiagnostics: options?.onDiagnostics,
      onFrame: options?.onFrame,
      onCursorSelectionChange: options?.onCursorSelectionChange,
      onError: options?.onError,
    }
  }, [options])

  const optionsRef = useRef(resolved)

  useEffect(() => {
    optionsRef.current = resolved
  }, [resolved])

  const hasExternalDataConsumer = Boolean(resolved.onData)

  const emitData = useCallback((payload: Uint8Array) => {
    optionsRef.current.onData?.(payload)
  }, [])

  const emitDiagnostics = useCallback(
    (diagnostics: TerminalRendererHandle['diagnostics']) => {
      optionsRef.current.onDiagnostics?.(diagnostics)
    },
    [],
  )

  const emitFrame = useCallback((event: TerminalFrameEvent) => {
    optionsRef.current.onFrame?.(event)
  }, [])

  const emitSelectionChange = useCallback(
    (selection: TerminalSelection | null) => {
      optionsRef.current.onCursorSelectionChange?.(selection)
    },
    [],
  )

  const emitError = useCallback((event: TerminalErrorEvent) => {
    optionsRef.current.onError?.(event)
  }, [])

  return {
    hasExternalDataConsumer,
    emitData,
    emitDiagnostics,
    emitFrame,
    emitSelectionChange,
    emitError,
  }
}
