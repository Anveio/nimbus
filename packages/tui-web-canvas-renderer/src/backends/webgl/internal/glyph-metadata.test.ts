import type { TerminalCell } from '@mana/vt'
import { describe, expect, test } from 'vitest'
import {
  computeGlyphRenderMetadata,
  deriveSelectionTint,
} from './glyph-metadata'

const baseCell = (overrides: Partial<TerminalCell> = {}): TerminalCell => ({
  char: 'a',
  attr: {
    bold: false,
    faint: false,
    italic: false,
    underline: 'none',
    blink: 'none',
    inverse: false,
    hidden: false,
    strikethrough: false,
    foreground: { type: 'default' },
    background: { type: 'default' },
  },
  protected: false,
  ...overrides,
})

const dummyTheme = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: { color: '#ffffff' },
  palette: { ansi: Array.from({ length: 16 }, () => '#000000') },
} as const

describe('glyph metadata planning', () => {
  test.todo(
    'detects double-width glyphs and marks skipTrailingColumns appropriately',
    () => {
      const cell = baseCell({ char: '語' })
      const meta = computeGlyphRenderMetadata(cell, dummyTheme)
      expect(meta.advanceCells).toBe(2)
      expect(meta.skipTrailingColumns).toBe(1)
    },
  )

  test.todo(
    'derives selection tint when cell is highlighted and respects theme overrides',
    () => {
      const cell = baseCell()
      const tint = deriveSelectionTint(cell, dummyTheme)
      expect(tint).toEqual([0, 0, 0, 0])
    },
  )
})
