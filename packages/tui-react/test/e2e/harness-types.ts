import type { CanvasRendererDiagnostics } from '@mana/tui-web-canvas-renderer'
import type { TerminalSelection, TerminalState } from '@mana/vt'
import type {
  ShortcutGuideReason,
  TerminalFrameEvent,
  TerminalStatusMessage,
} from '../../src/Terminal'

export interface TerminalHarnessInstrumentationOptions {
  readonly onData?: boolean
  readonly onDiagnostics?: boolean
  readonly onFrame?: boolean
  readonly onCursorSelectionChange?: boolean
  readonly onShortcutGuideToggle?: boolean
}

export interface TerminalHarnessShortcutGuideToggleEvent {
  readonly visible: boolean
  readonly reason: ShortcutGuideReason
}

export interface TerminalHarnessMountOptions {
  readonly rows?: number
  readonly columns?: number
  readonly ariaLabel?: string
  readonly localEcho?: boolean
  readonly autoFocus?: boolean
  readonly autoResize?: boolean
  readonly rendererBackend?: 'cpu-2d' | 'gpu-webgl'
  readonly instrumentation?: TerminalHarnessInstrumentationOptions
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
  getFrameEvents(): TerminalFrameEvent[]
  resetFrameEvents(): void
  getDiagnosticsEvents(): CanvasRendererDiagnostics[]
  resetDiagnosticsEvents(): void
  getCursorSelectionEvents(): Array<TerminalSelection | null>
  resetCursorSelectionEvents(): void
  getShortcutGuideToggleEvents(): TerminalHarnessShortcutGuideToggleEvent[]
  resetShortcutGuideToggleEvents(): void
  announceStatus(message: TerminalStatusMessage): void
  openShortcutGuide(): void
  closeShortcutGuide(): void
  toggleShortcutGuide(): void
  resetTerminal(): void
}
