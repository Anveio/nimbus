import type { CanvasRendererDiagnostics } from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalSelection, TerminalState } from '@mana-ssh/vt'
import type { TerminalStatusMessage } from '../../src/Terminal'

export interface TerminalHarnessMountOptions {
  readonly rows?: number
  readonly columns?: number
  readonly ariaLabel?: string
  readonly localEcho?: boolean
  readonly autoFocus?: boolean
  readonly autoResize?: boolean
  readonly rendererBackend?: 'cpu-2d' | 'gpu-webgl'
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
  compose(data: string): void
  getSnapshot(): TerminalState | null
  getSelection(): TerminalSelection | null
  getDiagnostics(): CanvasRendererDiagnostics | null
  getOnDataEvents(): TerminalHarnessOnDataEvent[]
  resetOnDataEvents(): void
  announceStatus(message: TerminalStatusMessage): void
}
