import { useCallback, useId, useMemo, useState } from 'react'
import { getSelectionRowSegments } from '@mana-ssh/vt'
import type { TerminalSelection, TerminalState } from '@mana-ssh/vt'
import type { ReactNode } from 'react'

const NON_BREAKING_SPACE = '\u00A0'

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export type TerminalStatusLevel = 'info' | 'warning' | 'error'

export interface TerminalStatusMessage {
  readonly kind: string
  readonly level: TerminalStatusLevel
  readonly message: string
}

interface TranscriptCell {
  readonly id: string
  readonly text: string
  readonly rawChar: string
  readonly row: number
  readonly column: number
  readonly selected: boolean
}

interface TranscriptRow {
  readonly id: string
  readonly row: number
  readonly text: string
  readonly cells: readonly TranscriptCell[]
}

interface SelectionIndex {
  readonly cells: ReadonlySet<string>
  readonly rowExtents: ReadonlyMap<number, number>
}

interface TerminalAccessibilityOptions {
  readonly snapshot: TerminalState
  readonly snapshotRevision: number
  readonly instructions?: ReactNode
}

interface TerminalAccessibilityResult {
  readonly instructionsId: string
  readonly instructionsContent: ReactNode
  readonly describedByIds: readonly string[]
  readonly transcriptId: string
  readonly transcriptRows: readonly TranscriptRow[]
  readonly activeDescendantId: string | null
  readonly caretStatusText: string
  readonly statusMessage: string
  readonly statusPoliteness: 'polite' | 'assertive'
  readonly announceStatus: (message: TerminalStatusMessage) => void
}

const DEFAULT_INSTRUCTIONS: ReactNode = (
  <>
    This region emulates a terminal session. Press Enter to send commands. Use
    Shift + Arrow keys to adjust the selection. Copy with Command or Control +
    C. Paste with Command or Control + V.
  </>
)

const createSelectionIndex = (
  selection: TerminalSelection | null | undefined,
  columns: number,
): SelectionIndex => {
  if (!selection) {
    return { cells: new Set(), rowExtents: new Map() }
  }
  const segments = getSelectionRowSegments(selection, columns)
  if (segments.length === 0) {
    return { cells: new Set(), rowExtents: new Map() }
  }
  const cells = new Set<string>()
  const rowExtents = new Map<number, number>()
  for (const segment of segments) {
    for (let column = segment.startColumn; column <= segment.endColumn; column += 1) {
      cells.add(`${segment.row}:${column}`)
      const previous = rowExtents.get(segment.row) ?? -1
      if (column > previous) {
        rowExtents.set(segment.row, column)
      }
    }
  }
  return { cells, rowExtents }
}

const createTranscript = (
  snapshot: TerminalState,
  transcriptId: string,
  selectionIndex: SelectionIndex,
): readonly TranscriptRow[] => {
  const rows: TranscriptRow[] = []
  for (let rowIndex = 0; rowIndex < snapshot.rows; rowIndex += 1) {
    const rowBuffer = snapshot.buffer[rowIndex] ?? []
    const rowId = `${transcriptId}-r${rowIndex}`
    const cells: TranscriptCell[] = []
    const characters: string[] = []

    let lastContentColumn = -1
    for (let columnIndex = snapshot.columns - 1; columnIndex >= 0; columnIndex -= 1) {
      const cell = rowBuffer[columnIndex]
      const rawChar = cell?.char ?? ' '
      if (rawChar !== ' ') {
        lastContentColumn = columnIndex
        break
      }
    }

    const selectionExtent = selectionIndex.rowExtents.get(rowIndex) ?? -1
    const maxColumn = Math.max(lastContentColumn, selectionExtent)
    const effectiveMaxColumn = Math.max(maxColumn, 0)

    for (let columnIndex = 0; columnIndex <= effectiveMaxColumn; columnIndex += 1) {
      const cell = rowBuffer[columnIndex]
      const rawChar = cell?.char ?? ' '
      const displayChar = rawChar === ' ' ? NON_BREAKING_SPACE : rawChar
      const cellId = `${rowId}-c${columnIndex}`
      const key = `${rowIndex}:${columnIndex}`
      const selected = selectionIndex.cells.has(key)
      cells.push({
        id: cellId,
        text: displayChar,
        rawChar,
        row: rowIndex,
        column: columnIndex,
        selected,
      })
      characters.push(rawChar)
    }

    rows.push({
      id: rowId,
      row: rowIndex,
      text: characters.join('').trimEnd(),
      cells,
    })
  }
  return rows
}

const resolveActiveCellId = (
  snapshot: TerminalState,
  transcriptId: string,
): string | null => {
  const target = snapshot.selection ? snapshot.selection.focus : snapshot.cursor
  if (!target) {
    return null
  }
  const row = clamp(target.row, 0, Math.max(0, snapshot.rows - 1))
  const column = clamp(target.column, 0, Math.max(0, snapshot.columns - 1))
  return `${transcriptId}-r${row}-c${column}`
}

const createCaretStatusText = (snapshot: TerminalState, hasSelection: boolean): string => {
  const focusPoint = snapshot.selection ? snapshot.selection.focus : snapshot.cursor
  if (!focusPoint) {
    return 'Cursor position unavailable'
  }
  const row = clamp(focusPoint.row, 0, Math.max(0, snapshot.rows - 1))
  const column = clamp(focusPoint.column, 0, Math.max(0, snapshot.columns - 1))
  const base = `Row ${row + 1}, column ${column + 1}`
  if (hasSelection && snapshot.selection) {
    const selectionSegments = getSelectionRowSegments(snapshot.selection, snapshot.columns)
    const cellsSelected = selectionSegments.reduce((total, segment) => {
      return total + (segment.endColumn - segment.startColumn + 1)
    }, 0)
    return `${base}. ${cellsSelected} cell${cellsSelected === 1 ? '' : 's'} selected.`
  }
  return base
}

export const useTerminalAccessibility = (
  options: TerminalAccessibilityOptions,
): TerminalAccessibilityResult => {
  const {
    snapshot,
    snapshotRevision,
    instructions = DEFAULT_INSTRUCTIONS,
  } = options

  const instructionsId = useId()
  const transcriptId = useId()

  const selectionIndex = useMemo(
    () => createSelectionIndex(snapshot.selection ?? null, snapshot.columns),
    [snapshotRevision, snapshot.selection, snapshot.columns],
  )

  const transcriptRows = useMemo(
    () => createTranscript(snapshot, transcriptId, selectionIndex),
    [snapshotRevision, snapshot, transcriptId, selectionIndex],
  )

  const activeDescendantId = useMemo(
    () => resolveActiveCellId(snapshot, transcriptId),
    [snapshotRevision, snapshot, transcriptId],
  )

  const caretStatusText = useMemo(
    () => createCaretStatusText(snapshot, selectionIndex.cells.size > 0),
    [snapshotRevision, snapshot, selectionIndex],
  )

  const [status, setStatus] = useState<
    (TerminalStatusMessage & { readonly timestamp: number }) | null
  >(null)

  const announceStatus = useCallback((message: TerminalStatusMessage) => {
    setStatus({ ...message, timestamp: Date.now() })
  }, [])

  const statusPoliteness: 'polite' | 'assertive' =
    status?.level === 'error' ? 'assertive' : 'polite'

  const hasInstructions = instructions !== null && instructions !== undefined

  return {
    instructionsId,
    instructionsContent: instructions,
    describedByIds: hasInstructions ? [instructionsId] : [],
    transcriptId,
    transcriptRows,
    activeDescendantId,
    caretStatusText,
    statusMessage: status?.message ?? '',
    statusPoliteness,
    announceStatus,
  }
}
