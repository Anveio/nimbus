import type { CellDelta, TerminalUpdate } from '../../vt/src/interpreter/delta'
import type {
  TerminalAttributes,
  TerminalCell,
  TerminalState,
} from '../../vt/src/interpreter/state'
import { blankCell } from '../../vt/src/interpreter/state'
import { createInterpreter } from '../../vt/src/interpreter/terminal-interpreter'
import { createParser } from '../../vt/src/parser'
import type {
  ParserEvent,
  ParserEventSink,
  ParserOptions,
  TerminalCapabilities,
} from '../../vt/src/types'

const STYLE_ID = 'tui-terminal-style'

const DEFAULT_THEME = {
  background: '#1e1e1e',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorText: '#1e1e1e',
  palette: [
    '#000000',
    '#ff5555',
    '#50fa7b',
    '#f1fa8c',
    '#bd93f9',
    '#ff79c6',
    '#8be9fd',
    '#f8f8f2',
  ],
  paletteBright: [
    '#4d4d4d',
    '#ff6e67',
    '#5af78e',
    '#f4f99d',
    '#caa9fa',
    '#ff92d0',
    '#9aedfe',
    '#ffffff',
  ],
} as const

export interface TerminalTheme {
  readonly background?: string
  readonly foreground?: string
  readonly cursor?: string
  readonly cursorText?: string
  readonly palette?: ReadonlyArray<string>
  readonly paletteBright?: ReadonlyArray<string>
}

export interface TerminalUIOptions {
  readonly parser?: ParserOptions
  readonly capabilities?: TerminalCapabilities
  readonly className?: string
  readonly fontFamily?: string
  readonly fontSize?: string
  readonly lineHeight?: number
  readonly theme?: TerminalTheme
  readonly renderer?: 'canvas' | 'svg'
  readonly onBell?: () => void
}

interface Renderer {
  readonly element: HTMLElement
  init(state: TerminalState): void
  applyUpdates(updates: TerminalUpdate[], state: TerminalState): void
  dispose(): void
}

interface CellMetrics {
  readonly width: number
  readonly height: number
}

interface ResolvedTheme {
  readonly background: string
  readonly foreground: string
  readonly cursor: string
  readonly cursorText: string
  readonly palette: string[]
  readonly paletteBright: string[]
}

class EventBuffer implements ParserEventSink {
  readonly events: ParserEvent[] = []

  onEvent(event: ParserEvent): void {
    this.events.push(event)
  }
}

export class TerminalUI {
  private readonly options: TerminalUIOptions
  private readonly root: HTMLElement
  private readonly renderer: Renderer
  private readonly parser: ReturnType<typeof createParser>
  private readonly interpreter: ReturnType<typeof createInterpreter>

  constructor(options: TerminalUIOptions | undefined, mount: HTMLElement) {
    this.options = options ?? {}
    if (typeof document === 'undefined') {
      throw new Error('TerminalUI requires a DOM environment')
    }
    this.root = mount
    TerminalUI.ensureStyles()
    this.applyRootStyles()

    const rendererKind = this.options.renderer ?? 'canvas'
    if (rendererKind !== 'canvas') {
      throw new Error(
        `Unsupported renderer "${rendererKind}" (only 'canvas' is implemented) `,
      )
    }

    this.renderer = new CanvasRenderer({
      root: this.root,
      theme: this.resolveTheme(),
      fontFamily: this.options.fontFamily ?? 'monospace',
      fontSize: this.options.fontSize ?? '14px',
      lineHeight: this.options.lineHeight ?? 1.2,
    })

    this.root.appendChild(this.renderer.element)
    this.parser = createParser(this.options.parser ?? {})
    this.interpreter = createInterpreter({
      parser: this.options.parser,
      capabilities: this.options.capabilities,
    })
    this.renderer.init(this.interpreter.snapshot)
  }

  static ensureStyles(): void {
    if (typeof document === 'undefined') {
      return
    }
    if (document.getElementById(STYLE_ID)) {
      return
    }
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .tui-terminal {
        --tui-bg: #1e1e1e;
        --tui-fg: #f8f8f2;
        --tui-cursor: #f8f8f2;
        --tui-font-family: monospace;
        --tui-font-size: 14px;
        --tui-line-height: 1.2;
        position: relative;
        display: inline-block;
        background: var(--tui-bg);
        color: var(--tui-fg);
        font-family: var(--tui-font-family);
        font-size: var(--tui-font-size);
        line-height: var(--tui-line-height);
        user-select: none;
      }
      .tui-terminal canvas {
        display: block;
      }
    `
    document.head.appendChild(style)
  }

  write(data: Uint8Array | string): void {
    const sink = new EventBuffer()
    this.parser.write(data, sink)
    const updates = this.interpreter.handleEvents(sink.events)
    this.processUpdates(updates)
  }

  reset(): void {
    this.interpreter.reset()
    this.renderer.init(this.interpreter.snapshot)
  }

  dispose(): void {
    this.renderer.dispose()
  }

  getCapabilities(): TerminalCapabilities {
    return this.interpreter.capabilities
  }

  private processUpdates(updates: TerminalUpdate[]): void {
    if (updates.length === 0) {
      return
    }

    const filtered: TerminalUpdate[] = []
    let bell = false

    for (const update of updates) {
      if (update.type === 'bell') {
        bell = true
      } else {
        filtered.push(update)
      }
    }

    if (bell) {
      this.options.onBell?.()
    }

    if (filtered.length > 0) {
      this.renderer.applyUpdates(filtered, this.interpreter.snapshot)
    }
  }

  private resolveTheme(): ResolvedTheme {
    const theme = this.options.theme ?? {}
    const palette = [...(theme.palette ?? DEFAULT_THEME.palette)]
    const paletteBright = [
      ...(theme.paletteBright ?? DEFAULT_THEME.paletteBright),
    ]

    // Ensure palettes have at least 8 entries
    const extendPalette = (target: string[], fallback: readonly string[]) => {
      for (let i = target.length; i < fallback.length; i += 1) {
        target[i] =
          fallback[i] ??
          fallback[i % fallback.length] ??
          DEFAULT_THEME.foreground
      }
      if (target.length < 8) {
        for (let i = target.length; i < 8; i += 1) {
          target[i] = fallback[i % fallback.length] ?? DEFAULT_THEME.foreground
        }
      }
    }

    extendPalette(palette as string[], DEFAULT_THEME.palette)
    extendPalette(paletteBright as string[], DEFAULT_THEME.paletteBright)

    return {
      background: theme.background ?? DEFAULT_THEME.background,
      foreground: theme.foreground ?? DEFAULT_THEME.foreground,
      cursor: theme.cursor ?? DEFAULT_THEME.cursor,
      cursorText:
        theme.cursorText ?? theme.background ?? DEFAULT_THEME.cursorText,
      palette: palette as string[],
      paletteBright: paletteBright as string[],
    }
  }

  private applyRootStyles(): void {
    this.root.classList.add('tui-terminal')
    if (this.options.className) {
      this.root.classList.add(this.options.className)
    }
    const theme = this.options.theme
    const background = theme?.background
    if (background !== undefined) {
      this.root.style.setProperty('--tui-bg', background)
    }
    const foreground = theme?.foreground
    if (foreground !== undefined) {
      this.root.style.setProperty('--tui-fg', foreground)
    }
    const cursor = theme?.cursor
    if (cursor !== undefined) {
      this.root.style.setProperty('--tui-cursor', cursor)
    }
    const fontFamily = this.options.fontFamily
    if (fontFamily !== undefined) {
      this.root.style.setProperty('--tui-font-family', fontFamily)
    }
    const fontSize = this.options.fontSize
    if (fontSize !== undefined) {
      this.root.style.setProperty('--tui-font-size', fontSize)
    }
    const lineHeight = this.options.lineHeight
    if (lineHeight !== undefined) {
      this.root.style.setProperty('--tui-line-height', String(lineHeight))
    }
  }
}

interface CanvasRendererInit {
  root: HTMLElement
  theme: ResolvedTheme
  fontFamily: string
  fontSize: string
  lineHeight: number
}

class CanvasRenderer implements Renderer {
  readonly element: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly theme: ResolvedTheme
  private readonly fontFamily: string
  private readonly fontSize: string
  private readonly lineHeight: number
  private cellMetrics: CellMetrics | null = null
  private rows = 0
  private columns = 0
  private lastCursor: { row: number; column: number } | null = null
  private cursorVisible = true
  private readonly dpr: number

  constructor(init: CanvasRendererInit) {
    this.theme = init.theme
    this.fontFamily = init.fontFamily
    this.fontSize = init.fontSize
    this.lineHeight = init.lineHeight

    this.element = document.createElement('div')
    this.element.style.position = 'relative'
    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.element.appendChild(this.canvas)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Unable to acquire 2D rendering context')
    }
    this.ctx = ctx
    this.dpr = window.devicePixelRatio ?? 1
  }

  get elementCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  init(state: TerminalState): void {
    this.rows = state.rows
    this.columns = state.columns
    if (!this.cellMetrics) {
      this.cellMetrics = this.measureCellMetrics()
    }
    this.resizeCanvas()
    this.renderFull(state)
    this.drawCursor(state)
  }

  applyUpdates(updates: TerminalUpdate[], state: TerminalState): void {
    if (!this.cellMetrics) {
      this.cellMetrics = this.measureCellMetrics()
      this.resizeCanvas()
    }

    let fullRender = this.ensureDimensions(state)
    const dirtyMap = new Map<string, CellDelta>()
    let cursorChanged = false
    let cursorVisibilityChanged = false

    for (const update of updates) {
      switch (update.type) {
        case 'cells':
          for (const cell of update.cells) {
            const key = `${cell.row}:${cell.column}`
            dirtyMap.set(key, cell)
          }
          break
        case 'clear':
        case 'scroll':
        case 'scroll-region':
          fullRender = true
          break
        case 'cursor':
          cursorChanged = true
          break
        case 'cursor-visibility':
          this.cursorVisible = update.value
          cursorVisibilityChanged = true
          break
        case 'mode':
        case 'attributes':
          break
      }
    }

    if (fullRender) {
      this.renderFull(state)
    } else if (dirtyMap.size > 0) {
      dirtyMap.forEach((cell) => {
        const current = state.buffer[cell.row]?.[cell.column]
        if (current) {
          this.renderCell(cell.row, cell.column, current, false)
        }
      })
    }

    if (fullRender || cursorChanged || cursorVisibilityChanged) {
      this.drawCursor(state)
    }
  }

  dispose(): void {
    this.element.remove()
  }

  private ensureDimensions(state: TerminalState): boolean {
    if (state.rows !== this.rows || state.columns !== this.columns) {
      this.rows = state.rows
      this.columns = state.columns
      this.resizeCanvas()
      return true
    }
    return false
  }

  private measureCellMetrics(): CellMetrics {
    const span = document.createElement('span')
    span.textContent = 'M'
    span.style.position = 'absolute'
    span.style.visibility = 'hidden'
    span.style.pointerEvents = 'none'
    span.style.fontFamily = this.fontFamily
    span.style.fontSize = this.fontSize
    this.element.appendChild(span)
    const rect = span.getBoundingClientRect()
    this.element.removeChild(span)

    const heightFallback = parseFloat(this.fontSize) * this.lineHeight
    const width = rect.width || parseFloat(this.fontSize) * 0.6
    const height = rect.height || heightFallback
    return { width, height }
  }

  private resizeCanvas(): void {
    const metrics = this.cellMetrics ?? { width: 8, height: 16 }
    const width = metrics.width * this.columns
    const height = metrics.height * this.rows

    this.canvas.width = Math.max(1, Math.floor(width * this.dpr))
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr))
    this.canvas.style.width = `${Math.max(width, 1)}px`
    this.canvas.style.height = `${Math.max(height, 1)}px`

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.ctx.font = `${this.fontSize} ${this.fontFamily}`
    this.ctx.textBaseline = 'top'
  }

  private renderFull(state: TerminalState): void {
    const metrics = this.cellMetrics ?? { width: 8, height: 16 }
    this.ctx.fillStyle = this.theme.background
    this.ctx.fillRect(
      0,
      0,
      metrics.width * this.columns,
      metrics.height * this.rows,
    )

    for (let row = 0; row < state.rows; row += 1) {
      const rowBuffer = state.buffer[row]
      if (!rowBuffer) {
        continue
      }
      for (let column = 0; column < state.columns; column += 1) {
        const cell = rowBuffer[column] ?? blankCell(state.attributes)
        this.renderCell(row, column, cell, false)
      }
    }
    this.lastCursor = null
  }

  private renderCell(
    row: number,
    column: number,
    cell: TerminalCell,
    invert: boolean,
  ): void {
    const metrics = this.cellMetrics ?? { width: 8, height: 16 }
    const x = column * metrics.width
    const y = row * metrics.height

    const fg = this.resolveForeground(cell.attr, invert)
    const bg = this.resolveBackground(cell.attr, invert)

    this.ctx.fillStyle = bg
    this.ctx.fillRect(x, y, metrics.width, metrics.height)

    const char = cell.char.length > 0 ? cell.char.charAt(0) : ' '
    if (char !== ' ' || invert) {
      this.ctx.fillStyle = fg
      this.ctx.fillText(char, x, y)
    }
  }

  private drawCursor(state: TerminalState): void {
    if (this.lastCursor) {
      const prev = this.lastCursor
      if (prev.row < state.rows && prev.column < state.columns) {
        const rowBuffer = state.buffer[prev.row]
        if (rowBuffer) {
          const cell = rowBuffer[prev.column] ?? blankCell(state.attributes)
          this.renderCell(prev.row, prev.column, cell, false)
        }
      }
      this.lastCursor = null
    }

    if (!this.cursorVisible) {
      return
    }

    const { row, column } = state.cursor
    if (row < 0 || column < 0 || row >= state.rows || column >= state.columns) {
      return
    }
    const rowBuffer = state.buffer[row]
    if (!rowBuffer) {
      return
    }
    const cell = rowBuffer[column] ?? blankCell(state.attributes)
    this.renderCell(row, column, cell, true)
    this.lastCursor = { row, column }
  }

  private resolveForeground(attr: TerminalAttributes, invert: boolean): string {
    if (invert) {
      return this.theme.cursorText
    }
    if (attr.fg !== null && attr.fg !== undefined) {
      const idx = clampIndex(attr.fg, this.theme.palette.length)
      if (attr.bold) {
        return paletteColor(
          this.theme.paletteBright,
          idx,
          this.theme.foreground,
        )
      }
      return paletteColor(this.theme.palette, idx, this.theme.foreground)
    }
    return this.theme.foreground
  }

  private resolveBackground(attr: TerminalAttributes, invert: boolean): string {
    if (invert) {
      return this.theme.cursor
    }
    if (attr.bg !== null && attr.bg !== undefined) {
      const idx = clampIndex(attr.bg, this.theme.palette.length)
      return paletteColor(this.theme.palette, idx, this.theme.background)
    }
    return this.theme.background
  }
}

const clampIndex = (index: number, length: number): number => {
  if (length === 0) {
    return 0
  }
  if (index < 0) {
    return 0
  }
  if (index >= length) {
    return length - 1
  }
  return index
}

const paletteColor = (
  palette: string[],
  index: number,
  fallback: string,
): string => palette[index] ?? fallback

export default TerminalUI
