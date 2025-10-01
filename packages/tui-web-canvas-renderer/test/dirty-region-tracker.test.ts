import type { TerminalSelection } from '@mana/vt'
import { describe, expect, it } from 'vitest'
import { DirtyRegionTracker } from '../src/internal/dirty-region-tracker'

const flushInitialFullState = (tracker: DirtyRegionTracker) => {
  tracker.consume(1, 1)
}

describe('DirtyRegionTracker', () => {
  it('tracks individual cells', () => {
    const tracker = new DirtyRegionTracker()
    flushInitialFullState(tracker)

    tracker.markCell(0, 0)
    const result = tracker.consume(2, 2)
    expect(result.mode).toBe('partial')
    expect(result.cells).toBe(1)
    expect(result.coverage).toBeCloseTo(0.25)
    expect(result.rows.size).toBe(1)
    expect(result.rows.get(0)).toEqual([{ start: 0, end: 0 }])
  })

  it('marks full viewport when requested', () => {
    const tracker = new DirtyRegionTracker()
    tracker.markFull()
    const result = tracker.consume(10, 10)
    expect(result.mode).toBe('full')
    expect(result.cells).toBe(100)
    expect(result.coverage).toBe(1)
    expect(result.rows.size).toBe(0)
  })

  it('merges overlapping ranges on the same row', () => {
    const tracker = new DirtyRegionTracker()
    flushInitialFullState(tracker)

    tracker.markRange(3, 2, 4)
    tracker.markRange(3, 4, 6)
    const result = tracker.consume(8, 10)
    expect(result.mode).toBe('partial')
    expect(result.cells).toBe(5)
    expect(result.coverage).toBeCloseTo(5 / 80)
    expect(result.rows.size).toBe(1)
    expect(result.rows.get(3)).toEqual([{ start: 2, end: 6 }])
  })

  it('handles selection spans across rows', () => {
    const tracker = new DirtyRegionTracker()
    flushInitialFullState(tracker)

    const selection: TerminalSelection = {
      anchor: { row: 0, column: 0, timestamp: 1 },
      focus: { row: 1, column: 1, timestamp: 2 },
      kind: 'normal',
      status: 'idle',
    }

    tracker.markSelection(selection, 4)
    const result = tracker.consume(4, 4)
    expect(result.mode).toBe('partial')
    expect(result.cells).toBe(5)
    expect(result.coverage).toBeCloseTo(5 / 16)
    expect(result.rows.size).toBe(2)
    expect(result.rows.get(0)).toEqual([{ start: 0, end: 3 }])
    expect(result.rows.get(1)).toEqual([{ start: 0, end: 0 }])
  })
})
