import type {
  RendererConfiguration,
  RuntimePointerEventPhase,
} from '@nimbus/webgl-renderer'
import type {
  TerminalPointerButton,
  TerminalPointerModifierState,
} from '@nimbus/vt'
import { useEffect } from 'react'
import { useRendererSessionContext } from './renderer-session-context'
import { useRendererSurface } from './renderer-surface-context'

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

const mapPointerButton = (button: number): TerminalPointerButton => {
  switch (button) {
    case 0:
      return 'left'
    case 1:
      return 'middle'
    case 2:
      return 'right'
    case 3:
      return 'aux1'
    case 4:
      return 'aux2'
    default:
      return 'none'
  }
}

const normalizeModifiers = (
  input:
    | Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
    | Pick<WheelEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): TerminalPointerModifierState | undefined => {
  const modifiers: TerminalPointerModifierState = {
    ...(input.shiftKey ? { shift: true } : {}),
    ...(input.altKey ? { alt: true } : {}),
    ...(input.metaKey ? { meta: true } : {}),
    ...(input.ctrlKey ? { ctrl: true } : {}),
  }
  return Object.keys(modifiers).length > 0 ? modifiers : undefined
}

const getRelativePosition = (
  target: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } => {
  const rect = target.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  }
}

const getCellPosition = (
  position: { readonly x: number; readonly y: number },
  configuration: RendererConfiguration,
): { readonly row: number; readonly column: number } | null => {
  const cellWidth = configuration.cell.width
  const cellHeight = configuration.cell.height
  if (cellWidth <= 0 || cellHeight <= 0) {
    return null
  }

  const columnIndex = Math.floor(position.x / cellWidth)
  const rowIndex = Math.floor(position.y / cellHeight)

  const column = clamp(
    columnIndex + 1,
    1,
    Math.max(1, configuration.grid.columns),
  )
  const row = clamp(rowIndex + 1, 1, Math.max(1, configuration.grid.rows))
  return { row, column }
}

export const RendererEventBridge = (): null => {
  const canvas = useRendererSurface()
  const { session, configuration } = useRendererSessionContext()

  useEffect(() => {
    if (!session || !configuration) {
      return
    }

    const handlePointerEvent =
      (phase: RuntimePointerEventPhase) => (event: PointerEvent) => {
        const relativePosition = getRelativePosition(
          canvas,
          event.clientX,
          event.clientY,
        )
        const cell = getCellPosition(relativePosition, configuration)
        if (!cell) {
          return
        }

        const modifiers = normalizeModifiers(event)
        event.preventDefault()

        if (phase === 'down' && typeof canvas.setPointerCapture === 'function') {
          try {
            canvas.setPointerCapture(event.pointerId)
          } catch {
            // ignore setPointerCapture errors (unsupported pointer type)
          }
        }

        if (
          (phase === 'up' || phase === 'cancel') &&
          typeof canvas.releasePointerCapture === 'function'
        ) {
          try {
            canvas.releasePointerCapture(event.pointerId)
          } catch {
            // ignore releasePointerCapture errors
          }
        }

        session.dispatch({
          type: 'runtime.pointer',
          action: phase,
          pointerId: event.pointerId,
          button: mapPointerButton(event.button),
          buttons: event.buttons ?? 0,
          position: relativePosition,
          cell,
          modifiers,
        })
      }

    const handleWheel = (event: WheelEvent) => {
      const relativePosition = getRelativePosition(
        canvas,
        event.clientX,
        event.clientY,
      )
      const cell = getCellPosition(relativePosition, configuration)
      if (!cell) {
        return
      }
      event.preventDefault()
      session.dispatch({
        type: 'runtime.wheel',
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        cell,
        modifiers: normalizeModifiers(event),
      })
    }

    const pointerDown = handlePointerEvent('down')
    const pointerMove = handlePointerEvent('move')
    const pointerUp = handlePointerEvent('up')
    const pointerCancel = handlePointerEvent('cancel')

    const wheelListenerOptions: AddEventListenerOptions = { passive: false }

    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerCancel)
    canvas.addEventListener('wheel', handleWheel, wheelListenerOptions)

    return () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerCancel)
      canvas.removeEventListener('wheel', handleWheel, wheelListenerOptions)
    }
  }, [canvas, session, configuration])

  return null
}
