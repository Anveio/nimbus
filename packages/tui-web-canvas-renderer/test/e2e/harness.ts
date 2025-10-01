import type {
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from '@mana-ssh/vt'
import {
  type CanvasRenderer,
  createCanvasRenderer,
  type RendererMetrics,
  type RendererTheme,
} from '../../src/index'

interface RendererStore {
  renderer: CanvasRenderer | null
  snapshot: TerminalState | null
  theme: RendererTheme | null
  metrics: RendererMetrics | null
  selectionEvents: Array<TerminalSelection | null>
  overlayEvents: Array<{
    selection: TerminalSelection | null
  }>
}

interface InitRendererOptions {
  readonly snapshot: TerminalState
  readonly theme: RendererTheme
  readonly metrics: RendererMetrics
  readonly backend?: 'cpu' | 'webgl'
  readonly useCustomCursorOverlay?: boolean
}

interface ResizeOptions {
  readonly snapshot: TerminalState
  readonly metrics: RendererMetrics
}

interface UpdateOptions {
  readonly snapshot: TerminalState
  readonly updates: ReadonlyArray<TerminalUpdate>
}

declare global {
  interface Window {
    __manaRendererTest__?: {
      initRenderer: (options: InitRendererOptions) => void
      applyUpdates: (options: UpdateOptions) => void
      resize: (options: ResizeOptions) => void
      setTheme: (theme: RendererTheme) => void
      sync: (snapshot: TerminalState) => void
      setSnapshotCell: (row: number, column: number, cell: unknown) => void
      setSelection: (selection: TerminalSelection | null) => void
      setCursorVisibility: (visible: boolean) => void
      setCursorPosition: (row: number, column: number) => void
      getPixel: (x: number, y: number) => [number, number, number, number]
      getDiagnostics: () => CanvasRenderer['diagnostics'] | null
      getSelectionEvents: () => Array<TerminalSelection | null>
      getOverlayEvents: () => Array<{ selection: TerminalSelection | null }>
      setSelectionListener: () => void
      getBackend: () => string | null
      dispose: () => void
    }
  }
}

const store: RendererStore = {
  renderer: null,
  snapshot: null,
  theme: null,
  metrics: null,
  selectionEvents: [],
  overlayEvents: [],
}

const ensureRenderer = (): CanvasRenderer => {
  if (!store.renderer) {
    throw new Error('Renderer not initialised')
  }
  return store.renderer
}

const ensureSnapshot = (): TerminalState => {
  if (!store.snapshot) {
    throw new Error('Snapshot not initialised')
  }
  return store.snapshot
}

const toSelection = (value: unknown): TerminalSelection | null => {
  if (value === null || typeof value !== 'object') {
    return null
  }
  return value as TerminalSelection
}

window.__manaRendererTest__ = {
  initRenderer(options) {
    if (store.renderer) {
      store.renderer.dispose()
    }

    store.selectionEvents = []
    store.overlayEvents = []

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(
      1,
      options.metrics.cell.width * options.snapshot.columns,
    )
    canvas.height = Math.max(
      1,
      options.metrics.cell.height * options.snapshot.rows,
    )
    canvas.dataset.testid = 'renderer-canvas'

    document.body.innerHTML = ''
    document.body.appendChild(canvas)

    const cursorOverlay = options.useCustomCursorOverlay
      ? ({
          ctx,
          snapshot,
          metrics,
          theme,
          selection,
        }: {
          ctx: CanvasRenderingContext2D
          snapshot: TerminalState
          metrics: RendererMetrics
          theme: RendererTheme
          selection: TerminalSelection | null
        }) => {
          store.overlayEvents.push({ selection })
          ctx.fillStyle = theme.cursor.color
          ctx.fillRect(
            snapshot.cursor.column * metrics.cell.width,
            snapshot.cursor.row * metrics.cell.height,
            metrics.cell.width,
            metrics.cell.height,
          )
        }
      : undefined

    const renderer = createCanvasRenderer({
      canvas,
      metrics: options.metrics,
      theme: options.theme,
      snapshot: options.snapshot,
      cursorOverlayStrategy: cursorOverlay,
      backend: options.backend === 'webgl' ? { type: 'gpu-webgl' } : undefined,
      onSelectionChange: (selection) => {
        store.selectionEvents.push(selection)
      },
    })

    store.renderer = renderer
    store.snapshot = options.snapshot
    store.theme = options.theme
    store.metrics = options.metrics
  },

  applyUpdates({ snapshot, updates }) {
    store.snapshot = snapshot
    ensureRenderer().applyUpdates({ snapshot, updates })
  },

  resize({ snapshot, metrics }) {
    store.snapshot = snapshot
    store.metrics = metrics
    ensureRenderer().resize({ snapshot, metrics })
  },

  setTheme(theme) {
    store.theme = theme
    ensureRenderer().setTheme(theme)
  },

  sync(snapshot) {
    store.snapshot = snapshot
    ensureRenderer().sync(snapshot)
  },

  setSnapshotCell(row, column, cell) {
    const snapshot = ensureSnapshot()
    if (!snapshot.buffer[row]) {
      snapshot.buffer[row] = []
    }
    snapshot.buffer[row]![column] =
      cell as TerminalState['buffer'][number][number]
  },

  setSelection(selection) {
    const snapshot = ensureSnapshot()
    snapshot.selection = toSelection(selection)
  },

  setCursorVisibility(visible) {
    const snapshot = ensureSnapshot()
    snapshot.cursorVisible = visible
  },

  setCursorPosition(row, column) {
    const snapshot = ensureSnapshot()
    snapshot.cursor = { ...snapshot.cursor, row, column }
  },

  getPixel(x, y) {
    const renderer = ensureRenderer()
    const ctx = renderer.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Unable to access 2D context')
    }
    const data = ctx.getImageData(x, y, 1, 1).data
    return [data[0]!, data[1]!, data[2]!, data[3]!]
  },

  getDiagnostics() {
    return ensureRenderer().diagnostics
  },

  getSelectionEvents() {
    return [...store.selectionEvents]
  },

  getOverlayEvents() {
    return [...store.overlayEvents]
  },

  setSelectionListener() {
    const renderer = ensureRenderer()
    renderer.onSelectionChange = (selection) => {
      store.selectionEvents.push(selection)
    }
  },

  getBackend() {
    const renderer = ensureRenderer()
    const canvas = renderer.canvas as HTMLCanvasElement
    return canvas.dataset?.manaRendererBackend ?? null
  },

  dispose() {
    if (store.renderer) {
      store.renderer.dispose()
    }
    store.renderer = null
    store.snapshot = null
    store.theme = null
    store.metrics = null
    store.selectionEvents = []
    store.overlayEvents = []
    document.body.innerHTML = ''
  },
}
