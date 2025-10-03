export type PrinterEvent =
  | { readonly type: 'controller-mode'; readonly enabled: boolean }
  | { readonly type: 'auto-print-mode'; readonly enabled: boolean }
  | { readonly type: 'print-screen'; readonly lines: string[] }
  | { readonly type: 'write'; readonly data: Uint8Array }

export const clonePrinterEvent = (event: PrinterEvent): PrinterEvent => {
  switch (event.type) {
    case 'print-screen':
      return { ...event, lines: [...event.lines] }
    case 'write':
      return { ...event, data: event.data.slice() }
    default:
      return { ...event }
  }
}
