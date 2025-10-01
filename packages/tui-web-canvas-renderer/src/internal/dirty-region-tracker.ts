import type { TerminalSelection } from '@mana-ssh/vt'
import { getSelectionRowSegments } from '@mana-ssh/vt'

interface RowSpan {
  start: number
  end: number
}

interface ConsumeResult {
  readonly mode: 'none' | 'partial' | 'full'
  readonly cells: number
  readonly coverage: number | null
  readonly rows: Map<number, ReadonlyArray<RowSpan>>
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/**
 * Tracks dirty regions so the renderer can quantify or act on partial updates.
 *
 * Today the GPU backend still rebuilds full-frame geometry, but coverage data
 * helps instrumentation and paves the way for diff-based rendering. The tracker
 * is deliberately conservative: when unsure it marks the full viewport to avoid
 * under-invalidation.
 */
export class DirtyRegionTracker {
  private isFull: boolean
  private readonly dirtyRows: Map<number, RowSpan[]>

  constructor() {
    this.isFull = true
    this.dirtyRows = new Map()
  }

  markFull(): void {
    if (this.isFull && this.dirtyRows.size === 0) {
      return
    }
    this.isFull = true
    this.dirtyRows.clear()
  }

  markCell(row: number, column: number): void {
    if (this.isFull) {
      return
    }
    this.markRange(row, column, column)
  }

  markRow(row: number): void {
    if (this.isFull) {
      return
    }
    this.markRange(row, 0, Number.POSITIVE_INFINITY)
  }

  markRange(row: number, startColumn: number, endColumn: number): void {
    if (this.isFull) {
      return
    }
    if (!Number.isFinite(row)) {
      this.markFull()
      return
    }
    const normalizedRow = Math.trunc(row)
    if (!Number.isFinite(startColumn) || !Number.isFinite(endColumn)) {
      this.addSpan(normalizedRow, 0, Number.POSITIVE_INFINITY)
      return
    }
    const start = Math.trunc(Math.min(startColumn, endColumn))
    const end = Math.trunc(Math.max(startColumn, endColumn))
    this.addSpan(normalizedRow, start, end)
  }

  markSelection(selection: TerminalSelection | null, columns: number): void {
    if (this.isFull || !selection) {
      return
    }
    const segments = getSelectionRowSegments(selection, columns)
    for (const segment of segments) {
      this.addSpan(segment.row, segment.startColumn, segment.endColumn)
    }
  }

  consume(rows: number, columns: number): ConsumeResult {
    const totalCells = rows * columns
    if (rows <= 0 || columns <= 0 || totalCells <= 0) {
      this.resetPartialState()
      return {
        mode: 'none',
        cells: 0,
        coverage: null,
        rows: new Map(),
      }
    }
    if (this.isFull) {
      this.resetPartialState()
      return {
        mode: 'full',
        cells: totalCells,
        coverage: 1,
        rows: new Map(),
      }
    }

    let dirtyCells = 0
    const normalizedRows = new Map<number, ReadonlyArray<RowSpan>>()
    for (const [row, spans] of this.dirtyRows) {
      if (row < 0 || row >= rows) {
        continue
      }
      if (spans.length === 0) {
        continue
      }
      const normalizedSpans: RowSpan[] = []
      for (const span of spans) {
        const start = clamp(span.start, 0, columns - 1)
        const end = clamp(span.end, start, columns - 1)
        if (end < start) {
          continue
        }
        dirtyCells += end - start + 1
        normalizedSpans.push({ start, end })
      }
      if (normalizedSpans.length > 0) {
        normalizedRows.set(row, normalizedSpans)
      }
    }

    const coverage = dirtyCells > 0 ? dirtyCells / totalCells : 0
    this.resetPartialState()
    return {
      mode: dirtyCells > 0 ? 'partial' : 'none',
      cells: dirtyCells,
      coverage,
      rows: normalizedRows,
    }
  }

  private addSpan(row: number, startColumn: number, endColumn: number): void {
    if (this.isFull) {
      return
    }
    const spans = this.dirtyRows.get(row) ?? []
    spans.push({ start: startColumn, end: endColumn })
    spans.sort((a, b) => a.start - b.start)
    const merged: RowSpan[] = []
    for (const span of spans) {
      if (merged.length === 0) {
        merged.push({ ...span })
        continue
      }
      const last = merged[merged.length - 1]!
      if (span.start <= last.end + 1) {
        last.end = Math.max(last.end, span.end)
      } else {
        merged.push({ ...span })
      }
    }
    this.dirtyRows.set(row, merged)
  }

  private resetPartialState(): void {
    this.isFull = false
    this.dirtyRows.clear()
  }
}
