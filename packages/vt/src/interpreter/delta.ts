import type { CursorPosition, TerminalAttributes, TerminalCell } from './state'

export interface CellDelta {
  readonly row: number
  readonly column: number
  readonly cell: TerminalCell
}

export type ClearScope =
  | 'display'
  | 'display-after-cursor'
  | 'line'
  | 'line-after-cursor'

export type TerminalUpdate =
  | { readonly type: 'cells'; readonly cells: ReadonlyArray<CellDelta> }
  | { readonly type: 'cursor'; readonly position: CursorPosition }
  | { readonly type: 'clear'; readonly scope: ClearScope }
  | { readonly type: 'scroll'; readonly amount: number }
  | { readonly type: 'bell' }
  | { readonly type: 'attributes'; readonly attributes: TerminalAttributes }
  | { readonly type: 'scroll-region'; readonly top: number; readonly bottom: number }
  | { readonly type: 'mode'; readonly mode: 'origin' | 'autowrap'; readonly value: boolean }
  | { readonly type: 'cursor-visibility'; readonly value: boolean }
