import type { MutableRefObject } from 'react'
import type {
  RendererEvent,
  RendererSession,
  SelectionPoint,
} from '@mana/webgl-renderer'

export type ShortcutGuideReason = 'hotkey' | 'imperative'

export type HotkeyRendererEvent = Extract<
  RendererEvent,
  | { readonly type: 'runtime.key' }
  | { readonly type: 'runtime.cursor.move' }
>

export interface HotkeyContext {
  readonly runtime: RendererSession['runtime']
  readonly performLocalErase: (direction: 'backspace' | 'delete') => boolean
  readonly clearSelection: () => void
  readonly toggleShortcutGuide: (reason: ShortcutGuideReason) => void
  readonly shortcutGuideEnabled: boolean
  readonly compositionStateRef: MutableRefObject<{
    active: boolean
    data: string
  }>
  readonly keyboardSelectionAnchorRef: MutableRefObject<SelectionPoint | null>
}

export interface HotkeyResult {
  readonly handled: boolean
  readonly preventDefault?: boolean
  readonly skipLocalEcho?: boolean
  readonly rendererEvents?: ReadonlyArray<HotkeyRendererEvent>
}

export const createHotkeyContext = (context: HotkeyContext): HotkeyContext =>
  context
