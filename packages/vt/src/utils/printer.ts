export interface PrinterController {
  setPrinterControllerMode(enabled: boolean): void
  setAutoPrintMode(enabled: boolean): void
  printScreen(lines: ReadonlyArray<string>): void
  write(data: Uint8Array): void
}

/**
 * Placeholder printer implementation. Real terminals stream data to a local
 * hardcopy device; for now we surface hooks that higher layers can observe.
 * TODO(@nimbus) Implement host-configurable printing (file download, piping to
 * a backend, etc.) once requirements solidify.
 */
export const createNoopPrinterController = (): PrinterController => ({
  setPrinterControllerMode: () => {},
  setAutoPrintMode: () => {},
  printScreen: () => {},
  write: () => {},
})
