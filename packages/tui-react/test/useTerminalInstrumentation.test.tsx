import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalSelection } from '@mana/vt'
import type { CanvasRendererDiagnostics } from '@mana/tui-web-canvas-renderer'
import type { TerminalRendererHandle } from '../src/renderer'
import {
  useTerminalInstrumentation,
  type TerminalErrorEvent,
  type TerminalFrameEvent,
} from '../src/instrumentation/terminal-instrumentation'

describe('useTerminalInstrumentation', () => {
  const diagnosticsSample = {
    lastFrameDurationMs: 0,
    lastDrawCallCount: 0,
    gpuFrameDurationMs: null,
    gpuDrawCallCount: null,
    gpuCellsProcessed: null,
    gpuBytesUploaded: null,
    gpuDirtyRegionCoverage: null,
    gpuOverlayBytesUploaded: null,
    gpuRowMetadata: null,
    lastOsc: null,
    lastSosPmApc: null,
    lastDcs: null,
  } satisfies CanvasRendererDiagnostics

  const diagnosticsPayload =
    diagnosticsSample as TerminalRendererHandle['diagnostics']

  const selectionSample: TerminalSelection = {
    anchor: { row: 0, column: 0, timestamp: 1 },
    focus: { row: 0, column: 1, timestamp: 2 },
    kind: 'normal',
    status: 'idle',
  }

  const frameSample: TerminalFrameEvent = {
    reason: 'sync',
    diagnostics: diagnosticsSample,
    timestamp: 100,
    backend: 'cpu',
  }

  const errorSample: TerminalErrorEvent = {
    source: 'terminal',
    error: new Error('boom'),
  }

  it('emits instrumentation callbacks when present', () => {
    const onData = vi.fn()
    const onDiagnostics = vi.fn()
    const onFrame = vi.fn()
    const onSelectionChange = vi.fn()
    const onError = vi.fn()

    const { result } = renderHook(() =>
      useTerminalInstrumentation({
        onData,
        onDiagnostics,
        onFrame,
        onCursorSelectionChange: onSelectionChange,
        onError,
      }),
    )

    const payload = new Uint8Array([1, 2, 3])

    act(() => {
      result.current.emitData(payload)
      result.current.emitDiagnostics(diagnosticsPayload)
      result.current.emitFrame(frameSample)
      result.current.emitSelectionChange(selectionSample)
      result.current.emitError(errorSample)
    })

    expect(onData).toHaveBeenCalledWith(payload)
    expect(onDiagnostics).toHaveBeenCalledWith(diagnosticsPayload)
    expect(onFrame).toHaveBeenCalledWith(frameSample)
    expect(onSelectionChange).toHaveBeenCalledWith(selectionSample)
    expect(onError).toHaveBeenCalledWith(errorSample)
    expect(result.current.hasExternalDataConsumer).toBe(true)
  })

  it('tracks option updates across renders', () => {
    const onDataInitial = vi.fn()
    const onDataUpdated = vi.fn()

    const { result, rerender } = renderHook(
      ({ onData }: { onData?: (data: Uint8Array) => void }) =>
        useTerminalInstrumentation({ onData }),
      { initialProps: { onData: onDataInitial } },
    )

    const payload = new Uint8Array([42])

    act(() => {
      result.current.emitData(payload)
    })
    expect(onDataInitial).toHaveBeenCalledWith(payload)

    rerender({ onData: onDataUpdated })

    act(() => {
      result.current.emitData(payload)
    })

    expect(onDataUpdated).toHaveBeenCalledWith(payload)
    expect(result.current.hasExternalDataConsumer).toBe(true)
  })

  it('handles undefined callbacks gracefully', () => {
    const { result } = renderHook(() => useTerminalInstrumentation(undefined))

    const payload = new Uint8Array([9])

    expect(() => {
      act(() => {
        result.current.emitData(payload)
        result.current.emitDiagnostics(null)
        result.current.emitFrame(frameSample)
        result.current.emitSelectionChange(null)
        result.current.emitError(errorSample)
      })
    }).not.toThrow()

    expect(result.current.hasExternalDataConsumer).toBe(false)
  })
})
