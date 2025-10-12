import type { TerminalCell } from '@nimbus/vt'
import { rendererColorToRgba } from '../../../util/colors'
import type { RendererTheme } from '../../../types'

export type SelectionTint = [number, number, number, number]

export interface GlyphRenderMetadata {
  /** Number of terminal cells this glyph should advance by. */
  readonly advanceCells: 1 | 2
  /** Whether this glyph should skip drawing in trailing columns (double-width). */
  readonly skipTrailingColumns: number
  /** Optional RGBA tint to apply when the glyph is inside a selection. */
  readonly selectionTint: SelectionTint | null
}

/**
 * Placeholder implementation. Computes glyph rendering metadata (width, tint, etc.).
 * TODO: implement according to selection/width rules.
 */
export const computeGlyphRenderMetadata = (
  cell: TerminalCell,
  theme: RendererTheme,
): GlyphRenderMetadata => {
  const advance = getAdvanceCells(cell)
  const skipTrailingColumns = advance === 2 ? 1 : 0
  return {
    advanceCells: advance,
    skipTrailingColumns,
    selectionTint: deriveSelectionTint(cell, theme),
  }
}

/**
 * Placeholder for deriving a selection tint from renderer theme and cell attributes.
 * TODO: produce deterministic selection tint aligned with accessibility requirements.
 */
export const deriveSelectionTint = (
  _cell: TerminalCell,
  theme: RendererTheme,
): SelectionTint | null => {
  const selectionBackground = theme.selection?.background
  if (!selectionBackground) {
    return null
  }
  const [r, g, b, a] = rendererColorToRgba(selectionBackground)
  return [r, g, b, a]
}

const getAdvanceCells = (cell: TerminalCell): 1 | 2 => {
  const text = cell.char
  if (!text) {
    return 1
  }
  const codePoint = text.codePointAt(0)
  if (typeof codePoint === 'undefined') {
    return 1
  }
  return isFullWidthCodePoint(codePoint) ? 2 : 1
}

// Adapted from sindresorhus/is-fullwidth-code-point (MIT License).
const isFullWidthCodePoint = (codePoint: number): boolean =>
  codePoint >= 0x1100 &&
  (codePoint <= 0x115f || // Hangul Jamo
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd))
