import type { TerminalSelection } from '@nimbus/vt'
import { describe, expect, it } from 'vitest'
import type { RendererTheme, TerminalProfile } from '../types'
import { mergeTerminalProfile } from './profile'

const makeTheme = (overrides: Partial<RendererTheme> = {}): RendererTheme => ({
  background: '#000000',
  foreground: '#ffffff',
  cursor: { color: '#ffffff' },
  palette: {
    ansi: Array.from({ length: 16 }, () => '#ffffff'),
    extended: [],
  },
  ...overrides,
})

describe('mergeTerminalProfile', () => {
  it('merges nested theme properties without discarding existing values', () => {
    const base: TerminalProfile = {
      theme: makeTheme({
        cursor: { color: '#ff0000', shape: 'block' },
      }),
    }

    const patch: TerminalProfile = {
      theme: makeTheme({
        cursor: { shape: 'underline', color: '#00ff00' },
      }),
    }

    const merged = mergeTerminalProfile(base, patch)
    expect(merged.theme?.cursor.color).toBe('#00ff00')
    expect(merged.theme?.cursor.shape).toBe('underline')
  })

  it('merges overlays preserving previous selection when patch omits it', () => {
    const selection: TerminalSelection = {
      kind: 'normal',
      status: 'dragging',
      anchor: { row: 0, column: 0, timestamp: 0 },
      focus: { row: 0, column: 1, timestamp: 1 },
    }

    const base: TerminalProfile = {
      overlays: { selection },
    }

    const merged = mergeTerminalProfile(base, { overlays: {} })
    expect(merged.overlays?.selection).toBe(selection)
  })
})
