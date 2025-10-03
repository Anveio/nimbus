import type { TerminalCell } from '@mana/vt'
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
  _cell: TerminalCell,
  _theme: RendererTheme,
): GlyphRenderMetadata => {
  throw new Error('computeGlyphRenderMetadata is not implemented yet')
}

/**
 * Placeholder for deriving a selection tint from renderer theme and cell attributes.
 * TODO: produce deterministic selection tint aligned with accessibility requirements.
 */
export const deriveSelectionTint = (
  _cell: TerminalCell,
  _theme: RendererTheme,
): SelectionTint | null => {
  throw new Error('deriveSelectionTint is not implemented yet')
}
