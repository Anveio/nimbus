import type { SosPmApcKind } from '../types'
import type {
  ClipboardEntry,
  CursorPosition,
  TerminalAttributes,
  TerminalCell,
  TerminalColor,
} from './state'
import type { TerminalSelection } from './selection'

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
  | {
      readonly type: 'scroll-region'
      readonly top: number
      readonly bottom: number
    }
  | {
      readonly type: 'mode'
      readonly mode:
        | 'origin'
        | 'autowrap'
        | 'reverse-video'
        | 'smooth-scroll'
        | 'keypad-application'
        | 'cursor-keys-application'
      readonly value: boolean
    }
  | { readonly type: 'cursor-visibility'; readonly value: boolean }
  | { readonly type: 'osc'; readonly identifier: string; readonly data: string }
  | { readonly type: 'title'; readonly title: string }
  | { readonly type: 'clipboard'; readonly clipboard: ClipboardEntry }
  | {
      readonly type: 'palette'
      readonly index: number
      readonly color: TerminalColor
    }
  | {
      readonly type: 'selection-set'
      readonly selection: TerminalSelection
    }
  | {
      readonly type: 'selection-update'
      readonly selection: TerminalSelection
    }
  | { readonly type: 'selection-clear' }
  | { readonly type: 'c1-transmission'; readonly value: '7-bit' | '8-bit' }
  | {
      readonly type: 'dcs-start'
      readonly finalByte: number
      readonly params: ReadonlyArray<number>
      readonly intermediates: ReadonlyArray<number>
    }
  | { readonly type: 'dcs-data'; readonly data: string }
  | {
      readonly type: 'dcs-end'
      readonly finalByte: number
      readonly params: ReadonlyArray<number>
      readonly intermediates: ReadonlyArray<number>
      readonly data: string
    }
  | {
      readonly type: 'sos-pm-apc'
      readonly kind: SosPmApcKind
      readonly data: string
    }
  | { readonly type: 'response'; readonly data: Uint8Array }
