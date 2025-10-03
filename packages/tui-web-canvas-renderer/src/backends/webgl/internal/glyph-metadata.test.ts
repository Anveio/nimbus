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
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: { color: '#ff00ff', opacity: 1, shape: 'block' },
  selection: { background: '#336699', foreground: '#ffffff' },
  palette: { ansi: Array.from({ length: 16 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`) },
} as const

describe('glyph render metadata', () => {
  test('detects double-width glyphs and marks skipTrailingColumns appropriately', () => {
    const cell = baseCell({ char: '語' })
    const meta = computeGlyphRenderMetadata(cell, dummyTheme)
    expect(meta.advanceCells).toBe(2)
    expect(meta.skipTrailingColumns).toBe(1)
  })

  test('uses single-cell advance for latin glyphs', () => {
    const meta = computeGlyphRenderMetadata(baseCell({ char: 'A' }), dummyTheme)
    expect(meta.advanceCells).toBe(1)
    expect(meta.skipTrailingColumns).toBe(0)
  })

  test('derives selection tint when selection background is provided', () => {
    const tint = deriveSelectionTint(baseCell(), dummyTheme)
    expect(tint).toEqual([0x33, 0x66, 0x99, 255])
  })

  test('returns null tint when selection theme is absent', () => {
    const noSelectionTheme = { ...dummyTheme, selection: undefined }
    const tint = deriveSelectionTint(baseCell(), noSelectionTheme)
    expect(tint).toBeNull()
  })
})
