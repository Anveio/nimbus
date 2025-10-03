import type { PrinterController } from '@mana/vt'
import { useCallback, useMemo, useRef } from 'react'
import { clonePrinterEvent, type PrinterEvent } from '../printer'

export interface UsePrinterControllerResult {
  readonly controller: PrinterController
  readonly getEventsSnapshot: () => PrinterEvent[]
  readonly resetEvents: () => void
}

export const usePrinterController = (): UsePrinterControllerResult => {
  const eventsRef = useRef<PrinterEvent[]>([])

  const recordEvent = useCallback((event: PrinterEvent) => {
    eventsRef.current.push(event)
  }, [])

  const controller = useMemo<PrinterController>(
    () => ({
      setPrinterControllerMode: (enabled) => {
        recordEvent({ type: 'controller-mode', enabled })
      },
      setAutoPrintMode: (enabled) => {
        recordEvent({ type: 'auto-print-mode', enabled })
      },
      printScreen: (lines) => {
        recordEvent({ type: 'print-screen', lines: [...lines] })
      },
      write: (data) => {
        recordEvent({ type: 'write', data: data.slice() })
      },
    }),
    [recordEvent],
  )

  const getEventsSnapshot = useCallback((): PrinterEvent[] => {
    return eventsRef.current.map(clonePrinterEvent)
  }, [])

  const resetEvents = useCallback(() => {
    eventsRef.current = []
  }, [])

  return { controller, getEventsSnapshot, resetEvents }
}
