export interface PrinterController {
  setPrinterControllerMode(enabled: boolean): void
  setAutoPrintMode(enabled: boolean): void
  printScreen(lines: ReadonlyArray<string>): void
  write(data: Uint8Array): void
}

export const createNoopPrinterController = (): PrinterController => ({
  setPrinterControllerMode: () => {},
  setAutoPrintMode: () => {},
  printScreen: () => {},
  write: () => {},
})
