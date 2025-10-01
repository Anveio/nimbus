import type { TerminalSelection, TerminalState } from '@mana-ssh/vt'

export interface TerminalHarnessMountOptions {
  readonly rows?: number
  readonly columns?: number
  readonly ariaLabel?: string
  readonly localEcho?: boolean
  readonly autoFocus?: boolean
  readonly autoResize?: boolean
}

export interface TerminalHarnessOnDataEvent {
  readonly text: string
  readonly bytes: number[]
}

export interface TerminalHarnessExports {
  mount(options?: TerminalHarnessMountOptions): Promise<void>
  dispose(): void
  focus(): void
  write(data: string): void
  getSnapshot(): TerminalState | null
  getSelection(): TerminalSelection | null
  getOnDataEvents(): TerminalHarnessOnDataEvent[]
  resetOnDataEvents(): void
}
