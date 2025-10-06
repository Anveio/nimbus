import { RendererSession } from '@mana/webgl-renderer'

export type ShortcutGuideReason = 'hotkey' | 'imperative'

export interface MoveCursorOptions {
  readonly extendSelection: boolean
}


export interface HotkeyContext {
  readonly runtime: RendererSession['runtime']
  readonly performLocalErase: (direction: 'backspace' | 'delete') => boolean
  readonly clearSelection: () => void
  readonly write: (data: Uint8Array | string) => void
  readonly onData?: (data: Uint8Array) => void
  readonly toggleShortcutGuide: (reason: ShortcutGuideReason) => void
  readonly shortcutGuideEnabled: boolean
  readonly compositionStateRef: {
    current: { active: boolean; data: string }
  }
}

export interface HotkeyResult {
  readonly handled: boolean
  readonly preventDefault?: boolean
  readonly skipLocalEcho?: boolean
  readonly clearKeyboardAnchor?: boolean
}

export const createHotkeyContext = (context: HotkeyContext): HotkeyContext =>
  context
