import {
  createInterpreter,
  createParser,
  type ParserEvent,
  type ParserEventSink,
  type ParserOptions,
  type TerminalCapabilities,
  type TerminalUpdate,
} from '@mana-ssh/vt'

const STYLE_ID = 'tui-terminal-style'

interface TerminalTheme {
  readonly background?: string
  readonly foreground?: string
  readonly cursor?: string
}

export interface TerminalUIOptions {
  readonly parser?: ParserOptions
  readonly capabilities?: TerminalCapabilities
  readonly className?: string
  readonly fontFamily?: string
  readonly fontSize?: string
  readonly padding?: string
  readonly theme?: TerminalTheme
  readonly onBell?: () => void
}

interface CellMetrics {
  readonly width: number
  readonly height: number
}

class EventBuffer implements ParserEventSink {
  readonly events: ParserEvent[] = []

  onEvent(event: ParserEvent): void {
    this.events.push(event)
  }
}

export class TerminalUI {
  private readonly root: HTMLElement
  private readonly bufferEl: HTMLDivElement
  private readonly cursorEl: HTMLDivElement
  private readonly lineElements: HTMLDivElement[] = []
  private readonly parser = createParser(this.options.parser ?? {})
  private readonly interpreter = createInterpreter({
    parser: this.options.parser,
    capabilities: this.options.capabilities,
  })
  private cellMetrics: CellMetrics | null = null

  constructor(private readonly options: TerminalUIOptions, mount: HTMLElement) {
    if (typeof document === 'undefined') {
      throw new Error('TerminalUI requires a DOM environment')
    }
    this.root = mount
    TerminalUI.ensureStyles()
    this.applyRootStyles()

    this.bufferEl = document.createElement('div')
    this.bufferEl.className = 'tui-terminal__buffer'
    this.bufferEl.style.position = 'relative'
    this.bufferEl.style.whiteSpace = 'pre'
    this.bufferEl.style.display = 'inline-block'
    this.root.appendChild(this.bufferEl)

    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'tui-terminal__cursor'
    this.cursorEl.style.position = 'absolute'
    this.cursorEl.style.pointerEvents = 'none'
    this.cursorEl.style.opacity = '1'
    this.cursorEl.style.display = 'none'
    this.bufferEl.appendChild(this.cursorEl)

    this.renderFull()
    this.measureCellMetrics()
    this.renderCursor()
  }

  static ensureStyles(): void {
    if (typeof window === 'undefined') {
      return
    }
    if (document.getElementById(STYLE_ID)) {
      return
    }
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .tui-terminal {
        --tui-bg: #000;
        --tui-fg: #f5f5f5;
        --tui-cursor: #f5f5f5;
        --tui-font-family: monospace;
        --tui-font-size: 14px;
        --tui-padding: 8px;
        position: relative;
        display: inline-block;
        background: var(--tui-bg);
        color: var(--tui-fg);
        font-family: var(--tui-font-family);
        font-size: var(--tui-font-size);
        line-height: 1.2;
        padding: var(--tui-padding);
        user-select: none;
        box-sizing: border-box;
      }
      .tui-terminal__buffer {
        font: inherit;
        color: inherit;
      }
      .tui-terminal__line {
        white-space: pre;
        font: inherit;
        color: inherit;
      }
      .tui-terminal__cursor {
        background: var(--tui-cursor);
        mix-blend-mode: difference;
      }
      .tui-terminal--cursor-hidden .tui-terminal__cursor {
        opacity: 0;
      }
    `
    document.head.appendChild(style)
  }

  write(data: Uint8Array | string): void {
    const sink = new EventBuffer()
    this.parser.write(data, sink)
    const updates = this.interpreter.handleEvents(sink.events)
    this.applyUpdates(updates)
  }

  reset(): void {
    this.interpreter.reset()
    this.renderFull()
    this.renderCursor()
  }

  getCapabilities(): TerminalCapabilities {
    return this.interpreter.capabilities
  }

  private applyRootStyles(): void {
    this.root.classList.add('tui-terminal')
    if (this.options.className) {
      this.root.classList.add(this.options.className)
    }
    if (this.options.theme?.background) {
      this.root.style.setProperty('--tui-bg', this.options.theme.background)
    }
    if (this.options.theme?.foreground) {
      this.root.style.setProperty('--tui-fg', this.options.theme.foreground)
    }
    if (this.options.theme?.cursor) {
      this.root.style.setProperty('--tui-cursor', this.options.theme.cursor)
    }
    if (this.options.fontFamily) {
      this.root.style.setProperty('--tui-font-family', this.options.fontFamily)
    }
    if (this.options.fontSize) {
      this.root.style.setProperty('--tui-font-size', this.options.fontSize)
    }
    if (this.options.padding) {
      this.root.style.setProperty('--tui-padding', this.options.padding)
    }
  }

  private applyUpdates(updates: TerminalUpdate[]): void {
    if (updates.length === 0) {
      return
    }

    const dirtyRows = new Set<number>()
    let needsFullRender = false
    let cursorNeedsUpdate = false

    for (const update of updates) {
      switch (update.type) {
        case 'cells':
          update.cells.forEach((cell) => dirtyRows.add(cell.row))
          break
        case 'clear':
        case 'scroll':
        case 'scroll-region':
          needsFullRender = true
          break
        case 'cursor':
          cursorNeedsUpdate = true
          break
        case 'cursor-visibility':
          cursorNeedsUpdate = true
          break
        case 'mode':
        case 'attributes':
          break
        case 'bell':
          this.options.onBell?.()
          break
      }
    }

    if (needsFullRender) {
      this.renderFull()
    } else {
      dirtyRows.forEach((row) => this.renderRow(row))
    }

    if (needsFullRender || cursorNeedsUpdate) {
      this.renderCursor()
    }
  }

  private ensureLineElements(target: number): void {
    const state = this.interpreter.snapshot
    while (this.lineElements.length < target) {
      const line = document.createElement('div')
      line.className = 'tui-terminal__line'
      line.textContent = ''.padEnd(state.columns, ' ')
      this.bufferEl.appendChild(line)
      this.lineElements.push(line)
    }
    while (this.lineElements.length > target) {
      const el = this.lineElements.pop()
      el?.remove()
    }
  }

  private renderRow(row: number): void {
    const state = this.interpreter.snapshot
    if (row < 0 || row >= state.rows) {
      return
    }
    this.ensureLineElements(state.rows)
    const cells = state.buffer[row]
    const text = cells.map((cell) => cell.char).join('')
    const line = this.lineElements[row]
    if (line) {
      line.textContent = text
    }
  }

  private renderFull(): void {
    const state = this.interpreter.snapshot
    this.ensureLineElements(state.rows)
    for (let row = 0; row < state.rows; row += 1) {
      const cells = state.buffer[row]
      this.lineElements[row].textContent = cells.map((cell) => cell.char).join('')
    }
  }

  private measureCellMetrics(): void {
    if (this.cellMetrics) {
      return
    }
    const probe = document.createElement('span')
    probe.textContent = 'M'
    probe.style.visibility = 'hidden'
    probe.style.position = 'absolute'
    probe.style.pointerEvents = 'none'
    this.bufferEl.appendChild(probe)
    const rect = probe.getBoundingClientRect()
    this.bufferEl.removeChild(probe)
    const width = rect.width || 8
    const height = rect.height || 16
    this.cellMetrics = { width, height }
    this.cursorEl.style.width = `${width}px`
    this.cursorEl.style.height = `${height}px`
    this.cursorEl.style.display = 'block'
  }

  private renderCursor(): void {
    this.measureCellMetrics()
    const metrics = this.cellMetrics
    if (!metrics) {
      return
    }
    const state = this.interpreter.snapshot
    const x = state.cursor.column * metrics.width
    const y = state.cursor.row * metrics.height
    this.cursorEl.style.transform = `translate(${x}px, ${y}px)`
    if (state.cursorVisible) {
      this.root.classList.remove('tui-terminal--cursor-hidden')
    } else {
      this.root.classList.add('tui-terminal--cursor-hidden')
    }
  }
}

export default TerminalUI
