import { describe, expect, it } from 'vitest'
import {
  getSelectionBounds,
  getSelectionRowSegment,
  getSelectionRowSegments,
  isSelectionCollapsed,
  type SelectionKind,
  type TerminalSelection,
} from '../src/selection'

const createSelection = (
  anchorRow: number,
  anchorColumn: number,
  focusRow: number,
  focusColumn: number,
  kind: SelectionKind = 'normal',
  status: 'idle' | 'dragging' = 'idle',
): TerminalSelection => ({
  anchor: { row: anchorRow, column: anchorColumn, timestamp: 1 },
  focus: { row: focusRow, column: focusColumn, timestamp: 2 },
  kind,
  status,
})

describe('selection helpers', () => {
  it('orders bounds for normal selections', () => {
    const selection = createSelection(5, 10, 2, 3)
    const { topLeft, bottomRight } = getSelectionBounds(selection)
    expect(topLeft.row).toBe(2)
    expect(topLeft.column).toBe(3)
    expect(bottomRight.row).toBe(5)
    expect(bottomRight.column).toBe(10)
  })

  it('orders bounds for rectangular selections', () => {
    const selection = createSelection(3, 9, 1, 2, 'rectangular')
    const { topLeft, bottomRight } = getSelectionBounds(selection)
    expect(topLeft.row).toBe(1)
    expect(topLeft.column).toBe(2)
    expect(bottomRight.row).toBe(3)
    expect(bottomRight.column).toBe(9)
  })

  it('returns null segments outside of selection', () => {
    const selection = createSelection(2, 4, 4, 1)
    expect(getSelectionRowSegment(selection, 1, 80)).toBeNull()
    expect(getSelectionRowSegment(selection, 5, 80)).toBeNull()
  })

  it('computes row segments for single line selection', () => {
    const selection = createSelection(3, 5, 3, 12)
    const segment = getSelectionRowSegment(selection, 3, 80)
    expect(segment).not.toBeNull()
    expect(segment?.startColumn).toBe(5)
    expect(segment?.endColumn).toBe(11)
    expect(isSelectionCollapsed(selection)).toBe(false)
  })

  it('computes row segments across multiple lines', () => {
    const selection = createSelection(5, 7, 2, 10)
    const segments = getSelectionRowSegments(selection, 80)
    expect(segments).toEqual([
      { row: 2, startColumn: 10, endColumn: 79 },
      { row: 3, startColumn: 0, endColumn: 79 },
      { row: 4, startColumn: 0, endColumn: 79 },
      { row: 5, startColumn: 0, endColumn: 6 },
    ])
  })

  it('computes segments for rectangular selections', () => {
    const selection = createSelection(1, 6, 4, 2, 'rectangular')
    const segments = getSelectionRowSegments(selection, 80)
    expect(segments).toEqual([
      { row: 1, startColumn: 2, endColumn: 5 },
      { row: 2, startColumn: 2, endColumn: 5 },
      { row: 3, startColumn: 2, endColumn: 5 },
      { row: 4, startColumn: 2, endColumn: 5 },
    ])
  })

  it('treats caret positions as end-exclusive for trailing selections', () => {
    const selection = createSelection(0, 10, 0, 6)
    const segment = getSelectionRowSegment(selection, 0, 12)
    expect(segment).toEqual({ row: 0, startColumn: 6, endColumn: 9 })
  })

  it('clamps rectangular selections within viewport columns', () => {
    const selection = createSelection(0, -5, 0, 10, 'rectangular')
    const segment = getSelectionRowSegment(selection, 0, 5)
    expect(segment).toEqual({ row: 0, startColumn: 0, endColumn: 4 })
  })

  it('returns empty when no columns available', () => {
    const selection = createSelection(0, 0, 0, 0)
    expect(getSelectionRowSegment(selection, 0, 0)).toBeNull()
    expect(getSelectionRowSegments(selection, 0)).toEqual([])
    expect(isSelectionCollapsed(selection)).toBe(true)
  })
})
