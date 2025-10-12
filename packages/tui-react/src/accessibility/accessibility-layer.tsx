import type { HTMLAttributes, JSX, ReactNode } from 'react'
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ShortcutGuideReason } from '../hotkeys'
import type { RendererSession } from '@nimbus/webgl-renderer'
import type {
  SelectionPoint,
  TerminalSelection,
} from '@nimbus/webgl-renderer'
export type TerminalStatusLevel = 'info' | 'warning' | 'error'

export interface TerminalStatusMessage {
  readonly kind: string
  readonly level: TerminalStatusLevel
  readonly message: string
}

const NON_BREAKING_SPACE = '\u00A0'

const VISUALLY_HIDDEN_STYLE = {
  position: 'absolute' as const,
  width: '1px',
  height: '1px',
  margin: '-1px',
  border: 0,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'pre-wrap' as const,
}

const SHORTCUT_BACKDROP_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  backgroundColor: 'rgba(13, 17, 23, 0.88)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  zIndex: 1000,
}

const SHORTCUT_DIALOG_STYLE = {
  maxWidth: '640px',
  width: '100%',
  maxHeight: 'calc(100% - 48px)',
  overflowY: 'auto' as const,
  backgroundColor: '#0d1117',
  color: '#f0f6fc',
  borderRadius: '12px',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
  padding: '24px',
  outline: 'none',
}

const SHORTCUT_DIALOG_TITLE_STYLE = {
  margin: '0 0 12px',
  fontSize: '1.25rem',
  fontWeight: 600,
}

const SHORTCUT_DIALOG_DESCRIPTION_STYLE = {
  margin: '0 0 16px',
  color: '#9fb3c8',
  fontSize: '0.95rem',
}

const SHORTCUT_LIST_STYLE = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
}

const SHORTCUT_LIST_ITEM_STYLE = {
  marginBottom: '12px',
}

const SHORTCUT_KEYS_STYLE = {
  fontFamily: `'Fira Code', Menlo, monospace`,
  fontSize: '0.95rem',
  color: '#f8fafc',
}

const SHORTCUT_CLOSE_BUTTON_STYLE = {
  marginTop: '16px',
  alignSelf: 'flex-end',
  backgroundColor: '#238636',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  padding: '8px 14px',
  cursor: 'pointer',
  fontWeight: 600,
}

export const DEFAULT_ARIA_SHORTCUTS = [
  'Enter',
  'Shift+ArrowLeft',
  'Shift+ArrowRight',
  'Shift+ArrowUp',
  'Shift+ArrowDown',
  'Meta+ArrowLeft',
  'Meta+ArrowRight',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'Control+ArrowLeft',
  'Control+ArrowRight',
  'Meta+C',
  'Meta+V',
  'Control+Shift+C',
  'Control+Shift+V',
]

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export interface TerminalShortcut {
  readonly id: string
  readonly keys: readonly string[]
  readonly description: string
  readonly group?: string
  readonly ariaKeys?: readonly string[]
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

export interface ShortcutGuideConfig {
  readonly enabled?: boolean
  readonly initiallyOpen?: boolean
  readonly title?: string
  readonly description?: ReactNode
  readonly content?: ReactNode
}

export interface AccessibilityAdapterOptions {
  readonly snapshot: RendererSession['runtime']['snapshot']
  readonly instructions?: ReactNode
  readonly shortcutGuide?: ShortcutGuideConfig | false
  readonly onShortcutGuideToggle?: (
    visible: boolean,
    reason: ShortcutGuideReason,
  ) => void
}

export interface ShortcutGuideController {
  readonly enabled: boolean
  readonly visible: boolean
  readonly title: ReactNode
  readonly description: ReactNode
  readonly content: ReactNode
  open(reason: ShortcutGuideReason): void
  close(reason: ShortcutGuideReason): void
  toggle(reason: ShortcutGuideReason): void
}

export interface TerminalAccessibilityAdapter {
  readonly instructionsId: string
  readonly instructionsContent: ReactNode | null
  readonly describedByIds: readonly string[]
  readonly transcriptId: string
  readonly transcriptRows: readonly TranscriptRow[]
  readonly activeDescendantId: string | null
  readonly caretStatusText: string
  readonly statusMessage: string
  readonly statusPoliteness: 'polite' | 'assertive'
  readonly announceStatus: (message: TerminalStatusMessage) => void
  readonly shortcuts: readonly TerminalShortcut[]
  readonly shortcutGuide: ShortcutGuideController
}

const DEFAULT_SHORTCUTS: readonly TerminalShortcut[] = [
  {
    id: 'enter',
    keys: ['Enter'],
    ariaKeys: ['Enter'],
    description: 'Send the current command to the host.',
  },
  {
    id: 'shift-arrows',
    keys: ['Shift+Arrow keys'],
    ariaKeys: [
      'Shift+ArrowLeft',
      'Shift+ArrowRight',
      'Shift+ArrowUp',
      'Shift+ArrowDown',
    ],
    description: 'Adjust the active selection without leaving the terminal.',
  },
  {
    id: 'meta-arrows',
    keys: ['Cmd+Arrow keys'],
    ariaKeys: ['Meta+ArrowLeft', 'Meta+ArrowRight'],
    description: 'Jump to the start or end of the current line.',
  },
  {
    id: 'alt-arrows',
    keys: ['Alt/Option+Arrow keys'],
    ariaKeys: ['Alt+ArrowLeft', 'Alt+ArrowRight'],
    description: 'Jump word by word. Hold Shift to extend the selection.',
  },
  {
    id: 'ctrl-arrows',
    keys: ['Ctrl+Arrow keys'],
    ariaKeys: ['Control+ArrowLeft', 'Control+ArrowRight'],
    description: 'Jump to the start or end of the current line.',
  },
  {
    id: 'copy',
    keys: ['Ctrl/Cmd+C'],
    ariaKeys: ['Meta+C', 'Control+Shift+C'],
    description: 'Copy the current selection to the clipboard.',
  },
  {
    id: 'paste',
    keys: ['Ctrl/Cmd+V', 'Ctrl/Cmd+Shift+V'],
    ariaKeys: ['Meta+V', 'Control+Shift+V'],
    description:
      'Paste text at the cursor. Use the Shift variant where required.',
  },
]

const DEFAULT_INSTRUCTIONS: ReactNode = (
  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: WAI-ARIA compliance asserted in e2e tests
  <div aria-label="Terminal keyboard help">
    <p>
      This terminal does not take focus automatically. Move focus here when you
      are ready to type and use the shortcuts below to control the session.
    </p>
    <dl>
      {DEFAULT_SHORTCUTS.map((shortcut) => (
        <Fragment key={shortcut.id}>
          <dt>{shortcut.keys.join(' or ')}</dt>
          <dd>{shortcut.description}</dd>
        </Fragment>
      ))}
    </dl>
  </div>
)

interface SelectionSegment {
  readonly row: number
  readonly startColumn: number
  readonly endColumn: number
}

const clampCaret = (value: number, columns: number): number => {
  if (columns <= 0) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > columns) {
    return columns
  }
  return value
}

const compareSelectionPoints = (
  a: SelectionPoint,
  b: SelectionPoint,
): number => {
  if (a.row !== b.row) {
    return a.row - b.row
  }
  if (a.column !== b.column) {
    return a.column - b.column
  }
  return a.timestamp - b.timestamp
}

const resolveSelectionSegments = (
  selection: TerminalSelection,
  columns: number,
): SelectionSegment[] => {
  if (columns <= 0) {
    return []
  }

  const anchorRow = clamp(selection.anchor.row, 0, Number.MAX_SAFE_INTEGER)
  const focusRow = clamp(selection.focus.row, 0, Number.MAX_SAFE_INTEGER)

  if (selection.kind === 'rectangular') {
    const minRow = Math.min(anchorRow, focusRow)
    const maxRow = Math.max(anchorRow, focusRow)
    const startCaret = clampCaret(
      Math.min(selection.anchor.column, selection.focus.column),
      columns,
    )
    const endCaret = clampCaret(
      Math.max(selection.anchor.column, selection.focus.column),
      columns,
    )
    if (startCaret >= endCaret) {
      return []
    }
    const segments: SelectionSegment[] = []
    for (let row = minRow; row <= maxRow; row += 1) {
      segments.push({
        row,
        startColumn: startCaret,
        endColumn: endCaret - 1,
      })
    }
    return segments
  }

  const anchorPoint: SelectionPoint = {
    row: anchorRow,
    column: selection.anchor.column,
    timestamp: selection.anchor.timestamp,
  }
  const focusPoint: SelectionPoint = {
    row: focusRow,
    column: selection.focus.column,
    timestamp: selection.focus.timestamp,
  }

  const [start, end] =
    compareSelectionPoints(anchorPoint, focusPoint) <= 0
      ? [anchorPoint, focusPoint]
      : [focusPoint, anchorPoint]

  const segments: SelectionSegment[] = []
  for (let row = start.row; row <= end.row; row += 1) {
    const caretStart = clampCaret(row === start.row ? start.column : 0, columns)
    const caretEnd = clampCaret(row === end.row ? end.column : columns, columns)
    if (caretStart >= caretEnd) {
      continue
    }
    segments.push({
      row,
      startColumn: caretStart,
      endColumn: caretEnd - 1,
    })
  }
  return segments
}

const createSelectionIndex = (
  selection: TerminalSelection | null | undefined,
  columns: number,
): SelectionIndex => {
  if (!selection) {
    return { cells: new Set(), rowExtents: new Map() }
  }
  const segments = resolveSelectionSegments(selection, columns)
  if (segments.length === 0) {
    return { cells: new Set(), rowExtents: new Map() }
  }
  const cells = new Set<string>()
  const rowExtents = new Map<number, number>()
  for (const segment of segments) {
    for (
      let column = segment.startColumn;
      column <= segment.endColumn;
      column += 1
    ) {
      cells.add(`${segment.row}:${column}`)
      const previous = rowExtents.get(segment.row) ?? -1
      if (column > previous) {
        rowExtents.set(segment.row, column)
      }
    }
  }
  return { cells, rowExtents }
}

const createTranscriptRows = (
  snapshot: RendererSession['runtime']['snapshot'],
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
    for (
      let columnIndex = snapshot.columns - 1;
      columnIndex >= 0;
      columnIndex -= 1
    ) {
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

    for (
      let columnIndex = 0;
      columnIndex <= effectiveMaxColumn;
      columnIndex += 1
    ) {
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
  snapshot: RendererSession['runtime']['snapshot'],
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

const createCaretStatusText = (
  snapshot: RendererSession['runtime']['snapshot'],
  hasSelection: boolean,
): string => {
  const focusPoint = snapshot.selection
    ? snapshot.selection.focus
    : snapshot.cursor
  if (!focusPoint) {
    return 'Cursor position unavailable'
  }
  const row = clamp(focusPoint.row, 0, Math.max(0, snapshot.rows - 1))
  const column = clamp(focusPoint.column, 0, Math.max(0, snapshot.columns - 1))
  const base = `Row ${row + 1}, column ${column + 1}`
  if (hasSelection && snapshot.selection) {
    const selectionSegments = resolveSelectionSegments(
      snapshot.selection,
      snapshot.columns,
    )
    const cellsSelected = selectionSegments.reduce<number>(
      (total, segment) => {
        return total + (segment.endColumn - segment.startColumn + 1)
      },
      0,
    )
    return `${base}. ${cellsSelected} cell${cellsSelected === 1 ? '' : 's'} selected.`
  }
  return base
}

export const useTerminalAccessibilityAdapter = (
  options: AccessibilityAdapterOptions,
): TerminalAccessibilityAdapter => {
  const {
    snapshot,
    instructions = DEFAULT_INSTRUCTIONS,
    shortcutGuide: shortcutGuideProp = {},
    onShortcutGuideToggle,
  } = options

  const instructionsId = useId()
  const transcriptId = useId()

  const selectionIndex = useMemo(
    () => createSelectionIndex(snapshot.selection ?? null, snapshot.columns),
    [snapshot.selection, snapshot.columns],
  )

  const transcriptRows = useMemo(
    () => createTranscriptRows(snapshot, transcriptId, selectionIndex),
    [snapshot, transcriptId, selectionIndex],
  )

  const activeDescendantId = useMemo(
    () => resolveActiveCellId(snapshot, transcriptId),
    [snapshot, transcriptId],
  )

  const caretStatusText = useMemo(
    () => createCaretStatusText(snapshot, selectionIndex.cells.size > 0),
    [snapshot, selectionIndex],
  )

  const [status, setStatus] = useState<
    (TerminalStatusMessage & { readonly timestamp: number }) | null
  >(null)

  const announceStatus = useCallback((message: TerminalStatusMessage) => {
    setStatus({ ...message, timestamp: Date.now() })
  }, [])

  const statusPoliteness: 'polite' | 'assertive' =
    status?.level === 'error' ? 'assertive' : 'polite'

  const describedByIds = instructions ? [instructionsId] : []

  const shortcutGuideConfig: ShortcutGuideConfig & { enabled?: boolean } =
    shortcutGuideProp === false ? { enabled: false } : (shortcutGuideProp ?? {})

  const shortcutGuideEnabled =
    shortcutGuideConfig.enabled ?? shortcutGuideProp !== false

  const [shortcutGuideVisible, setShortcutGuideVisible] = useState(() => {
    const initial = shortcutGuideConfig.initiallyOpen ?? false
    return shortcutGuideEnabled && initial
  })

  const notifyShortcutGuideToggle = useCallback(
    (visible: boolean, reason: ShortcutGuideReason) => {
      onShortcutGuideToggle?.(visible, reason)
    },
    [onShortcutGuideToggle],
  )

  const openShortcutGuide = useCallback(
    (reason: ShortcutGuideReason) => {
      if (!shortcutGuideEnabled) {
        return
      }
      setShortcutGuideVisible((current) => {
        if (current) {
          return current
        }
        notifyShortcutGuideToggle(true, reason)
        return true
      })
    },
    [notifyShortcutGuideToggle, shortcutGuideEnabled],
  )
  const closeShortcutGuide = useCallback(
    (reason: ShortcutGuideReason) => {
      setShortcutGuideVisible((current) => {
        if (!current) {
          return current
        }
        notifyShortcutGuideToggle(false, reason)
        return false
      })
    },
    [notifyShortcutGuideToggle],
  )

  const toggleShortcutGuide = useCallback(
    (reason: ShortcutGuideReason) => {
      setShortcutGuideVisible((current) => {
        if (current) {
          notifyShortcutGuideToggle(false, reason)
          return false
        }
        if (!shortcutGuideEnabled) {
          return current
        }
        notifyShortcutGuideToggle(true, reason)
        return true
      })
    },
    [notifyShortcutGuideToggle, shortcutGuideEnabled],
  )

  useEffect(() => {
    if (!shortcutGuideEnabled && shortcutGuideVisible) {
      setShortcutGuideVisible(false)
      notifyShortcutGuideToggle(false, 'imperative')
    }
  }, [notifyShortcutGuideToggle, shortcutGuideEnabled, shortcutGuideVisible])

  return {
    instructionsId,
    instructionsContent: instructions,
    describedByIds,
    transcriptId,
    transcriptRows,
    activeDescendantId,
    caretStatusText,
    statusMessage: status?.message ?? '',
    statusPoliteness,
    announceStatus,
    shortcuts: DEFAULT_SHORTCUTS,
    shortcutGuide: {
      enabled: shortcutGuideEnabled,
      visible: shortcutGuideVisible,
      title: shortcutGuideConfig.title ?? 'Terminal shortcuts',
      description:
        shortcutGuideConfig.description ??
        'Review the keyboard gestures available in this terminal. Press Shift + ? at any time to reopen this guide.',
      content: shortcutGuideConfig.content ?? (
        <ul style={SHORTCUT_LIST_STYLE}>
          {DEFAULT_SHORTCUTS.map((shortcut) => (
            <li key={shortcut.id} style={SHORTCUT_LIST_ITEM_STYLE}>
              <div style={SHORTCUT_KEYS_STYLE}>
                {shortcut.keys.join(' or ')}
              </div>
              <div>{shortcut.description}</div>
            </li>
          ))}
        </ul>
      ),
      open: openShortcutGuide,
      close: closeShortcutGuide,
      toggle: toggleShortcutGuide,
    },
  }
}

export interface TerminalAccessibilityContainerProps {
  readonly role: string
  readonly tabIndex: number
  readonly 'aria-label': string
  readonly 'aria-multiline': 'true'
  readonly 'aria-roledescription': string
  readonly 'aria-keyshortcuts'?: string
  readonly 'aria-describedby'?: string
  readonly 'aria-activedescendant'?: string
}

export interface UseTerminalAccessibilityOptions
  extends AccessibilityAdapterOptions {
  readonly ariaLabel: string
  readonly focusTerminal: () => void
}

export interface UseTerminalAccessibilityResult {
  readonly adapter: TerminalAccessibilityAdapter
  readonly containerProps: TerminalAccessibilityContainerProps
}

export const useTerminalAccessibility = (
  options: UseTerminalAccessibilityOptions,
): UseTerminalAccessibilityResult => {
  const {
    ariaLabel,
    focusTerminal,
    shortcutGuide,
    onShortcutGuideToggle,
    ...adapterOptions
  } = options

  const adapter = useTerminalAccessibilityAdapter({
    ...adapterOptions,
    shortcutGuide,
    onShortcutGuideToggle,
  })

  const describedByValue =
    adapter.describedByIds.length > 0
      ? adapter.describedByIds.join(' ')
      : undefined

  const ariaKeyShortcuts = useMemo(() => {
    const keys = adapter.shortcuts.flatMap((shortcut) =>
      shortcut.ariaKeys ? [...shortcut.ariaKeys] : [...shortcut.keys],
    )
    if (keys.length === 0) {
      return undefined
    }
    const unique = Array.from(new Set(keys))
    const matchesDefault =
      unique.length === DEFAULT_ARIA_SHORTCUTS.length &&
      DEFAULT_ARIA_SHORTCUTS.every((combo) => unique.includes(combo))
    return matchesDefault ? DEFAULT_ARIA_SHORTCUTS.join(' ') : unique.join(' ')
  }, [adapter.shortcuts])

  const containerProps = useMemo<TerminalAccessibilityContainerProps>(
    () => ({
      role: 'textbox',
      tabIndex: 0,
      'aria-label': ariaLabel,
      'aria-multiline': 'true',
      'aria-roledescription': 'Terminal',
      'aria-keyshortcuts': ariaKeyShortcuts,
      'aria-describedby': describedByValue,
      'aria-activedescendant': adapter.activeDescendantId ?? undefined,
    }),
    [adapter.activeDescendantId, ariaKeyShortcuts, ariaLabel, describedByValue],
  )

  const previousGuideVisibleRef = useRef(adapter.shortcutGuide.visible)
  useEffect(() => {
    if (previousGuideVisibleRef.current && !adapter.shortcutGuide.visible) {
      focusTerminal()
    }
    previousGuideVisibleRef.current = adapter.shortcutGuide.visible
  }, [adapter.shortcutGuide.visible, focusTerminal])

  return { adapter, containerProps }
}

export interface TerminalAccessibilityLayerProps
  extends HTMLAttributes<HTMLDivElement> {
  readonly adapter: TerminalAccessibilityAdapter
  readonly instructionsContent?: ReactNode
}

export const TerminalAccessibilityLayer = forwardRef<
  HTMLDivElement,
  TerminalAccessibilityLayerProps
>(({ adapter, instructionsContent, children, ...containerProps }, ref) => {
  const instructions =
    instructionsContent ?? adapter.instructionsContent ?? DEFAULT_INSTRUCTIONS
  const instructionsNode = instructions ? (
    <div
      id={adapter.instructionsId}
      data-testid="terminal-instructions"
      role="note"
      style={VISUALLY_HIDDEN_STYLE}
    >
      {instructions}
    </div>
  ) : null

  const transcriptNode = (
    <div
      id={adapter.transcriptId}
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions text"
      data-testid="terminal-transcript"
      style={VISUALLY_HIDDEN_STYLE}
    >
      {/** biome-ignore lint/a11y/useSemanticElements: WAI-ARIA compliance asserted in e2e tests */}
      <div
        role="grid"
        aria-readonly="true"
        data-testid="terminal-transcript-grid"
      >
        {adapter.transcriptRows.map((row) => (
          // biome-ignore lint/a11y/useFocusableInteractive: WAI-ARIA compliance asserted in e2e tests
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA compliance asserted in e2e tests
          <div
            key={row.id}
            id={row.id}
            role="row"
            aria-rowindex={row.row + 1}
            data-testid="terminal-transcript-row"
          >
            {row.cells.map((cell) => (
              // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA compliance asserted in e2e tests
              // biome-ignore lint/a11y/useFocusableInteractive: WAI-ARIA compliance asserted in e2e tests
              <span
                key={cell.id}
                id={cell.id}
                role="gridcell"
                aria-colindex={cell.column + 1}
                data-testid="terminal-transcript-cell"
                aria-selected={cell.selected ? 'true' : undefined}
              >
                {cell.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  const caretStatusNode = (
    <output
      aria-live="polite"
      data-testid="terminal-caret-status"
      style={VISUALLY_HIDDEN_STYLE}
    >
      {adapter.caretStatusText}
    </output>
  )

  const statusRegionNode = (
    <output
      aria-live={adapter.statusPoliteness}
      data-testid="terminal-status-region"
      style={VISUALLY_HIDDEN_STYLE}
    >
      {adapter.statusMessage}
    </output>
  )

  const overlayNode =
    adapter.shortcutGuide.enabled && adapter.shortcutGuide.visible ? (
      <ShortcutGuideOverlay controller={adapter.shortcutGuide} />
    ) : null

  return (
    <div ref={ref} {...containerProps}>
      {instructionsNode}
      {transcriptNode}
      {caretStatusNode}
      {statusRegionNode}
      {overlayNode}
      {children}
    </div>
  )
})

TerminalAccessibilityLayer.displayName = 'TerminalAccessibilityLayer'

interface ShortcutGuideOverlayProps {
  readonly controller: ShortcutGuideController
}

const ShortcutGuideOverlay = ({
  controller,
}: ShortcutGuideOverlayProps): JSX.Element => {
  const titleId = useId()
  const descriptionId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (controller.visible && closeButtonRef.current) {
      const handle =
        typeof window !== 'undefined'
          ? window.requestAnimationFrame(() => closeButtonRef.current?.focus())
          : null
      return () => {
        if (handle !== null && typeof window !== 'undefined') {
          window.cancelAnimationFrame(handle)
        }
      }
    }
    return undefined
  }, [controller.visible])

  const handleBackdropClick = useCallback(() => {
    controller.close('imperative')
  }, [controller])

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        controller.close('imperative')
      }
    },
    [controller],
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is pointer-only escape surface
    <div
      style={SHORTCUT_BACKDROP_STYLE}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={SHORTCUT_DIALOG_STYLE}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id={titleId} style={SHORTCUT_DIALOG_TITLE_STYLE}>
          {controller.title}
        </h2>
        <p id={descriptionId} style={SHORTCUT_DIALOG_DESCRIPTION_STYLE}>
          {controller.description}
        </p>
        {controller.content}
        <button
          type="button"
          style={SHORTCUT_CLOSE_BUTTON_STYLE}
          ref={closeButtonRef}
          onClick={() => controller.close('imperative')}
        >
          Close
        </button>
      </div>
    </div>
  )
}

export type { ShortcutGuideReason } from '../hotkeys'
