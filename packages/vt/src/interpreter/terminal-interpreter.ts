import { resolveTerminalCapabilities } from '../capabilities'
import {
  type ParserEvent,
  ParserEventType,
  type ParserOptions,
  type TerminalCapabilities,
} from '../types'
import type { CellDelta, TerminalUpdate } from './delta'
import {
  blankCell,
  clearAllTabStops,
  clearTabStop,
  cloneAttributes,
  createInitialState,
  defaultAttributes,
  ensureRowCapacity,
  nextTabStop,
  resetRow,
  setCell,
  setTabStop,
  type TerminalCell,
  type TerminalColor,
  type TerminalState,
  type ClipboardEntry,
} from './state'

const QUESTION_MARK = '?'.charCodeAt(0)

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const clampColorComponent = (value: number): number =>
  clamp(Math.trunc(value), 0, 255)

interface ActiveDcs {
  readonly finalByte: number
  readonly params: ReadonlyArray<number>
  readonly intermediates: ReadonlyArray<number>
  readonly chunks: string[]
}

export interface InterpreterOptions {
  readonly parser?: ParserOptions
  readonly capabilities?: TerminalCapabilities
}

export class TerminalInterpreter {
  readonly capabilities: TerminalCapabilities
  private state: TerminalState
  private readonly textDecoder = new TextDecoder()
  private readonly printDecoder = new TextDecoder('utf-8', { fatal: false })
  private activeDcs: ActiveDcs | null = null

  constructor(options: InterpreterOptions = {}) {
    this.capabilities =
      options.capabilities ?? resolveTerminalCapabilities(options.parser ?? {})
    this.state = createInitialState(this.capabilities)
  }

  get snapshot(): TerminalState {
    return this.state
  }

  handleEvent(event: ParserEvent): TerminalUpdate[] {
    switch (event.type) {
      case ParserEventType.Print:
        return this.handlePrint(event.data)
      case ParserEventType.Execute:
        return this.handleExecute(event.codePoint)
      case ParserEventType.CsiDispatch:
        return this.handleCsi(event)
      case ParserEventType.EscDispatch:
        return this.handleEsc(event)
      case ParserEventType.OscDispatch:
        return this.handleOsc(event)
      case ParserEventType.DcsHook:
        return this.handleDcsHook(event)
      case ParserEventType.DcsPut:
        return this.handleDcsPut(event)
      case ParserEventType.DcsUnhook:
        return this.handleDcsUnhook()
      case ParserEventType.SosPmApcDispatch:
        return this.handleSosPmApc(event)
      default:
        return []
    }
  }

  handleEvents(events: Iterable<ParserEvent>): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    for (const event of events) {
      updates.push(...this.handleEvent(event))
    }
    return updates
  }

  reset(): void {
    this.state = createInitialState(this.capabilities)
    this.activeDcs = null
    this.printDecoder.decode()
  }

  private handlePrint(data: Uint8Array): TerminalUpdate[] {
    if (data.length === 0) {
      return []
    }

    const text = this.printDecoder.decode(data, { stream: true })
    const cellUpdates: CellDelta[] = []
    const miscUpdates: TerminalUpdate[] = []

    for (const char of text) {
      const result = this.writeChar(char)
      cellUpdates.push(...result.cells)
      miscUpdates.push(...result.updates)
    }

    const updates: TerminalUpdate[] = []
    if (cellUpdates.length > 0) {
      updates.push({ type: 'cells', cells: cellUpdates })
    }
    updates.push(...miscUpdates)
    return updates
  }

  private writeChar(char: string): {
    cells: CellDelta[]
    updates: TerminalUpdate[]
  } {
    if (char === '\r') {
      return { cells: [], updates: this.carriageReturn() }
    }
    if (char === '\n') {
      return { cells: [], updates: this.lineFeed(true) }
    }

    const row = this.state.cursor.row
    const column = this.state.cursor.column
    ensureRowCapacity(this.state, row)

    const cell: TerminalCell = {
      char,
      attr: cloneAttributes(this.state.attributes),
    }
    setCell(this.state, row, column, cell)

    const cells: CellDelta[] = [{ row, column, cell }]
    const updates: TerminalUpdate[] = []

    this.state.cursor.column += 1
    if (this.state.cursor.column >= this.state.columns) {
      if (this.state.autoWrap && this.capabilities.features.supportsAutoWrap) {
        this.state.cursor.column = this.state.columns - 1
        updates.push(...this.lineFeed(true))
      } else {
        this.state.cursor.column = this.state.columns - 1
        updates.push(this.cursorUpdate())
      }
    } else {
      updates.push(this.cursorUpdate())
    }

    return { cells, updates }
  }

  private handleExecute(codePoint: number): TerminalUpdate[] {
    switch (codePoint) {
      case 0x07:
        return [{ type: 'bell' }]
      case 0x08:
        return this.backspace()
      case 0x09:
        return this.horizontalTab()
      case 0x0a:
      case 0x0b:
      case 0x0c:
        return this.lineFeed(true)
      case 0x0d:
        return this.carriageReturn()
      default:
        return []
    }
  }

  private decode(buffer: Uint8Array): string {
    if (buffer.length === 0) {
      return ''
    }
    return this.textDecoder.decode(buffer)
  }

  private handleEsc(
    event: ParserEvent & { type: ParserEventType.EscDispatch },
  ): TerminalUpdate[] {
    const final = String.fromCharCode(event.finalByte)
    switch (final) {
      case 'D':
        return this.index()
      case 'E':
        return [...this.lineFeed(true), ...this.carriageReturn()]
      case 'H':
        return this.setTabStop()
      case 'M':
        return this.reverseIndex()
      case '7':
        return this.saveCursor()
      case '8':
        return this.restoreCursor()
      default:
        return []
    }
  }

  private handleOsc(
    event: ParserEvent & { type: ParserEventType.OscDispatch },
  ): TerminalUpdate[] {
    const raw = this.decode(event.data)
    const separator = raw.indexOf(';')
    const identifier = separator === -1 ? raw : raw.slice(0, separator)
    const payload = separator === -1 ? '' : raw.slice(separator + 1)
    const oscId = identifier === '' ? '0' : identifier

    const updates: TerminalUpdate[] = [{ type: 'osc', identifier: oscId, data: payload }]

    switch (oscId) {
      case '0':
      case '2':
        this.state.title = payload
        updates.push({ type: 'title', title: payload })
        break
      case '4':
        updates.push(...this.parsePaletteUpdates(payload))
        break
      case '52': {
        const selectionSplit = payload.indexOf(';')
        const selection = selectionSplit === -1 ? 'c' : payload.slice(0, selectionSplit) || 'c'
        const data = selectionSplit === -1 ? '' : payload.slice(selectionSplit + 1)
        const clipboard: ClipboardEntry = { selection, data }
        this.state.clipboard = clipboard
        updates.push({ type: 'clipboard', clipboard })
        break
      }
      default:
        break
    }

    return updates
  }

  private parsePaletteUpdates(data: string): TerminalUpdate[] {
    if (data.trim() === '') {
      return []
    }

    const parts = data.split(';')
    const updates: TerminalUpdate[] = []

    for (let index = 0; index < parts.length - 1; index += 2) {
      const slot = Number.parseInt(parts[index] ?? '', 10)
      const spec = parts[index + 1] ?? ''
      if (Number.isNaN(slot)) {
        continue
      }
      const color = this.parseColorSpec(spec)
      if (!color) {
        continue
      }
      updates.push({ type: 'palette', index: slot, color })
    }

    return updates
  }

  private parseColorSpec(spec: string): TerminalColor | null {
    const trimmed = spec.trim()
    if (trimmed.startsWith('rgb:')) {
      const [, channels] = trimmed.split(':')
      if (!channels) {
        return null
      }
      const components = channels.split('/')
      if (components.length !== 3) {
        return null
      }
      const rHex = components[0] ?? ''
      const gHex = components[1] ?? ''
      const bHex = components[2] ?? ''
      if (!rHex || !gHex || !bHex) {
        return null
      }
      const parseComponent = (value: string): number | null => {
        const normalized = value.length === 0 ? '0' : value
        const int = Number.parseInt(normalized, 16)
        if (Number.isNaN(int)) {
          return null
        }
        const scale = 16 ** normalized.length - 1 || 1
        return clampColorComponent((int / scale) * 255)
      }
      const r = parseComponent(rHex)
      const g = parseComponent(gHex)
      const b = parseComponent(bHex)
      if (r === null || g === null || b === null) {
        return null
      }
      return { type: 'rgb', r, g, b }
    }

    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1)
      if (hex.length === 6) {
        const r = Number.parseInt(hex.slice(0, 2), 16)
        const g = Number.parseInt(hex.slice(2, 4), 16)
        const b = Number.parseInt(hex.slice(4, 6), 16)
        if ([r, g, b].some((value) => Number.isNaN(value))) {
          return null
        }
        return {
          type: 'rgb',
          r: clampColorComponent(r),
          g: clampColorComponent(g),
          b: clampColorComponent(b),
        }
      }
    }

    return null
  }

  private handleDcsHook(
    event: ParserEvent & { type: ParserEventType.DcsHook },
  ): TerminalUpdate[] {
    this.activeDcs = {
      finalByte: event.finalByte,
      params: [...event.params],
      intermediates: [...event.intermediates],
      chunks: [],
    }
    return [
      {
        type: 'dcs-start',
        finalByte: event.finalByte,
        params: [...event.params],
        intermediates: [...event.intermediates],
      },
    ]
  }

  private handleDcsPut(
    event: ParserEvent & { type: ParserEventType.DcsPut },
  ): TerminalUpdate[] {
    if (!this.activeDcs) {
      return []
    }
    const chunk = this.decode(event.data)
    this.activeDcs.chunks.push(chunk)
    return [{ type: 'dcs-data', data: chunk }]
  }

  private handleDcsUnhook(): TerminalUpdate[] {
    if (!this.activeDcs) {
      return []
    }
    const { finalByte, params, intermediates, chunks } = this.activeDcs
    const data = chunks.join('')
    this.activeDcs = null
    return [
      {
        type: 'dcs-end',
        finalByte,
        params,
        intermediates,
        data,
      },
    ]
  }

  private handleSosPmApc(
    event: ParserEvent & { type: ParserEventType.SosPmApcDispatch },
  ): TerminalUpdate[] {
    const data = this.decode(event.data)
    this.state.lastSosPmApc = { kind: event.kind, data }
    return [{ type: 'sos-pm-apc', kind: event.kind, data }]
  }

  private handleCsi(
    event: ParserEvent & { type: ParserEventType.CsiDispatch },
  ): TerminalUpdate[] {
    if (event.prefix === QUESTION_MARK) {
      return this.handleDecPrivateMode(event)
    }

    const final = String.fromCharCode(event.finalByte)
    const params = event.params

    switch (final) {
      case 'A':
        return this.cursorUp(params[0] ?? 1)
      case 'B':
        return this.cursorDown(params[0] ?? 1)
      case 'C':
        return this.cursorForward(params[0] ?? 1)
      case 'D':
        return this.cursorBackward(params[0] ?? 1)
      case 'G':
        return this.cursorColumnAbsolute(params[0] ?? 1)
      case 'H':
      case 'f':
        return this.cursorPosition(params)
      case 'J':
        return this.eraseInDisplay(params[0] ?? 0)
      case 'K':
        return this.eraseInLine(params[0] ?? 0)
      case 'm':
        return this.selectGraphicRendition(params)
      case 'r':
        return this.setScrollRegion(params)
      case 'g':
        return this.clearTabStops(params[0] ?? 0)
      default:
        return []
    }
  }

  private handleDecPrivateMode(
    event: ParserEvent & { type: ParserEventType.CsiDispatch },
  ): TerminalUpdate[] {
    const final = String.fromCharCode(event.finalByte)
    if (final !== 'h' && final !== 'l') {
      return []
    }

    const enable = final === 'h'
    const updates: TerminalUpdate[] = []

    for (const param of event.params) {
      switch (param) {
        case 6: // DECOM
          updates.push(...this.setOriginMode(enable))
          break
        case 7: // DECAWM
          updates.push(...this.setAutoWrap(enable))
          break
        case 25: // DECTCEM
          updates.push(...this.setCursorVisibility(enable))
          break
        default:
          break
      }
    }

    return updates
  }

  private setOriginMode(enabled: boolean): TerminalUpdate[] {
    if (!this.capabilities.features.supportsOriginMode) {
      return []
    }
    this.state.originMode = enabled
    if (enabled) {
      this.state.cursor = { row: this.state.scrollTop, column: 0 }
    }
    return [
      { type: 'mode', mode: 'origin', value: enabled },
      this.cursorUpdate(),
    ]
  }

  private setAutoWrap(enabled: boolean): TerminalUpdate[] {
    if (!this.capabilities.features.supportsAutoWrap) {
      return []
    }
    this.state.autoWrap = enabled
    return [{ type: 'mode', mode: 'autowrap', value: enabled }]
  }

  private setCursorVisibility(visible: boolean): TerminalUpdate[] {
    if (!this.capabilities.features.supportsCursorVisibility) {
      return []
    }
    this.state.cursorVisible = visible
    return [{ type: 'cursor-visibility', value: visible }]
  }

  private setScrollRegion(params: ReadonlyArray<number>): TerminalUpdate[] {
    if (!this.capabilities.features.supportsScrollRegions) {
      return []
    }
    let top = clamp((params[0] ?? 1) - 1, 0, this.state.rows - 1)
    let bottom = clamp(
      (params[1] ?? this.state.rows) - 1,
      0,
      this.state.rows - 1,
    )

    if (top >= bottom) {
      top = 0
      bottom = this.state.rows - 1
    }

    this.state.scrollTop = top
    this.state.scrollBottom = bottom

    const updates: TerminalUpdate[] = [{ type: 'scroll-region', top, bottom }]
    if (this.state.originMode) {
      this.state.cursor = { row: top, column: 0 }
      updates.push(this.cursorUpdate())
    }
    return updates
  }

  private clearTabStops(mode: number): TerminalUpdate[] {
    if (!this.capabilities.features.supportsTabStops) {
      return []
    }
    switch (mode) {
      case 0:
      case 2:
        clearTabStop(this.state, this.state.cursor.column)
        break
      case 3:
        clearAllTabStops(this.state)
        break
      default:
        break
    }
    return []
  }

  private setTabStop(): TerminalUpdate[] {
    if (!this.capabilities.features.supportsTabStops) {
      return []
    }
    setTabStop(this.state, this.state.cursor.column)
    return []
  }

  private cursorPosition(params: ReadonlyArray<number>): TerminalUpdate[] {
    const baseRow = this.state.originMode ? this.state.scrollTop : 0
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1

    const row = clamp(baseRow + (params[0] ?? 1) - 1, minRow, maxRow)
    const column = clamp((params[1] ?? 1) - 1, 0, this.state.columns - 1)
    this.state.cursor = { row, column }
    return [this.cursorUpdate()]
  }

  private cursorUp(count: number): TerminalUpdate[] {
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1
    this.state.cursor.row = clamp(this.state.cursor.row - count, minRow, maxRow)
    return [this.cursorUpdate()]
  }

  private cursorDown(count: number): TerminalUpdate[] {
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1
    this.state.cursor.row = clamp(this.state.cursor.row + count, minRow, maxRow)
    return [this.cursorUpdate()]
  }

  private cursorForward(count: number): TerminalUpdate[] {
    this.state.cursor.column = clamp(
      this.state.cursor.column + count,
      0,
      this.state.columns - 1,
    )
    return [this.cursorUpdate()]
  }

  private cursorBackward(count: number): TerminalUpdate[] {
    this.state.cursor.column = clamp(
      this.state.cursor.column - count,
      0,
      this.state.columns - 1,
    )
    return [this.cursorUpdate()]
  }

  private cursorColumnAbsolute(value: number): TerminalUpdate[] {
    const column = clamp(value - 1, 0, this.state.columns - 1)
    this.state.cursor.column = column
    return [this.cursorUpdate()]
  }

  private eraseInDisplay(param: number): TerminalUpdate[] {
    switch (param) {
      case 2:
        for (let row = 0; row < this.state.rows; row += 1) {
          resetRow(this.state, row)
        }
        this.state.cursor = { row: 0, column: 0 }
        return [{ type: 'clear', scope: 'display' }, this.cursorUpdate()]
      default:
        return this.clearFromCursor()
    }
  }

  private eraseInLine(param: number): TerminalUpdate[] {
    const row = this.state.cursor.row
    let start = this.state.cursor.column
    let end = this.state.columns - 1

    if (param === 1) {
      start = 0
      end = this.state.cursor.column
    } else if (param === 2) {
      start = 0
    }

    const cells: CellDelta[] = []

    for (let column = start; column <= end; column += 1) {
      const cell = blankCell(this.state.attributes)
      setCell(this.state, row, column, cell)
      cells.push({ row, column, cell })
    }

    if (cells.length === 0) {
      return []
    }

    const scope = param === 0 ? 'line-after-cursor' : 'line'

    return [
      { type: 'cells', cells },
      { type: 'clear', scope },
    ]
  }

  private selectGraphicRendition(
    params: ReadonlyArray<number>,
  ): TerminalUpdate[] {
    let attributes = cloneAttributes(
      params.length === 0 ? defaultAttributes : this.state.attributes,
    )

    const setForeground = (color: TerminalColor): void => {
      attributes = { ...attributes, foreground: color }
    }

    const setBackground = (color: TerminalColor): void => {
      attributes = { ...attributes, background: color }
    }

    for (let index = 0; index < params.length; index += 1) {
      const param = params[index] ?? 0
      switch (param) {
        case 0:
          attributes = cloneAttributes(defaultAttributes)
          break
        case 1:
          attributes = { ...attributes, bold: true }
          break
        case 2:
          attributes = { ...attributes, faint: true }
          break
        case 3:
          attributes = { ...attributes, italic: true }
          break
        case 4:
          attributes = { ...attributes, underline: 'single' }
          break
        case 5:
          attributes = { ...attributes, blink: 'slow' }
          break
        case 6:
          attributes = { ...attributes, blink: 'rapid' }
          break
        case 7:
          attributes = { ...attributes, inverse: true }
          break
        case 8:
          attributes = { ...attributes, hidden: true }
          break
        case 9:
          attributes = { ...attributes, strikethrough: true }
          break
        case 21:
          attributes = { ...attributes, underline: 'double' }
          break
        case 22:
          attributes = { ...attributes, bold: false, faint: false }
          break
        case 23:
          attributes = { ...attributes, italic: false }
          break
        case 24:
          attributes = { ...attributes, underline: 'none' }
          break
        case 25:
          attributes = { ...attributes, blink: 'none' }
          break
        case 27:
          attributes = { ...attributes, inverse: false }
          break
        case 28:
          attributes = { ...attributes, hidden: false }
          break
        case 29:
          attributes = { ...attributes, strikethrough: false }
          break
        case 30:
        case 31:
        case 32:
        case 33:
        case 34:
        case 35:
        case 36:
        case 37:
          setForeground({ type: 'ansi', index: param - 30 })
          break
        case 38: {
          const mode = params[index + 1]
          if (mode === 5 && params.length > index + 2) {
            const paletteIndex = clamp(params[index + 2] ?? 0, 0, 255)
            setForeground({ type: 'palette', index: paletteIndex })
            index += 2
          } else if (mode === 2 && params.length > index + 4) {
            const r = clampColorComponent(params[index + 2] ?? 0)
            const g = clampColorComponent(params[index + 3] ?? 0)
            const b = clampColorComponent(params[index + 4] ?? 0)
            setForeground({ type: 'rgb', r, g, b })
            index += 4
          }
          break
        }
        case 39:
          setForeground({ type: 'default' })
          break
        case 40:
        case 41:
        case 42:
        case 43:
        case 44:
        case 45:
        case 46:
        case 47:
          setBackground({ type: 'ansi', index: param - 40 })
          break
        case 48: {
          const mode = params[index + 1]
          if (mode === 5 && params.length > index + 2) {
            const paletteIndex = clamp(params[index + 2] ?? 0, 0, 255)
            setBackground({ type: 'palette', index: paletteIndex })
            index += 2
          } else if (mode === 2 && params.length > index + 4) {
            const r = clampColorComponent(params[index + 2] ?? 0)
            const g = clampColorComponent(params[index + 3] ?? 0)
            const b = clampColorComponent(params[index + 4] ?? 0)
            setBackground({ type: 'rgb', r, g, b })
            index += 4
          }
          break
        }
        case 49:
          setBackground({ type: 'default' })
          break
        case 90:
        case 91:
        case 92:
        case 93:
        case 94:
        case 95:
        case 96:
        case 97:
          setForeground({ type: 'ansi-bright', index: param - 90 })
          break
        case 100:
        case 101:
        case 102:
        case 103:
        case 104:
        case 105:
        case 106:
        case 107:
          setBackground({ type: 'ansi-bright', index: param - 100 })
          break
        default:
          break
      }
    }

    this.state.attributes = attributes
    return [{ type: 'attributes', attributes }]
  }

  private lineFeed(resetColumn: boolean): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    const { cursor } = this.state

    if (this.withinScrollRegion(cursor.row)) {
      if (cursor.row === this.state.scrollBottom) {
        this.scrollRegionUp()
        updates.push({ type: 'scroll', amount: 1 })
      } else {
        cursor.row += 1
      }
    } else if (cursor.row < this.state.rows - 1) {
      cursor.row += 1
    }

    if (resetColumn) {
      cursor.column = 0
    }

    this.clampCursorRow()
    updates.push(this.cursorUpdate())
    return updates
  }

  private index(): TerminalUpdate[] {
    return this.lineFeed(false)
  }

  private reverseIndex(): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    const { cursor } = this.state

    if (this.withinScrollRegion(cursor.row)) {
      if (cursor.row === this.state.scrollTop) {
        this.scrollRegionDown()
        updates.push({ type: 'scroll', amount: -1 })
      } else {
        cursor.row -= 1
      }
    } else if (cursor.row > 0) {
      cursor.row -= 1
    }

    this.clampCursorRow()
    updates.push(this.cursorUpdate())
    return updates
  }

  private scrollRegionUp(): void {
    const top = this.state.scrollTop
    const bottom = this.state.scrollBottom
    for (let row = top; row < bottom; row += 1) {
      this.state.buffer[row] = this.state.buffer[row + 1]!
    }
    this.state.buffer[bottom] = Array.from({ length: this.state.columns }, () =>
      blankCell(this.state.attributes),
    )
  }

  private scrollRegionDown(): void {
    const top = this.state.scrollTop
    const bottom = this.state.scrollBottom
    for (let row = bottom; row > top; row -= 1) {
      this.state.buffer[row] = this.state.buffer[row - 1]!
    }
    this.state.buffer[top] = Array.from({ length: this.state.columns }, () =>
      blankCell(this.state.attributes),
    )
  }

  private carriageReturn(): TerminalUpdate[] {
    this.state.cursor.column = 0
    return [this.cursorUpdate()]
  }

  private backspace(): TerminalUpdate[] {
    if (this.state.cursor.column > 0) {
      this.state.cursor.column -= 1
    }
    return [this.cursorUpdate()]
  }

  private horizontalTab(): TerminalUpdate[] {
    if (this.capabilities.features.supportsTabStops) {
      const next = nextTabStop(this.state, this.state.cursor.column)
      if (next !== null) {
        this.state.cursor.column = next
      } else {
        this.state.cursor.column = this.state.columns - 1
      }
    } else {
      const next = Math.floor(this.state.cursor.column / 8) * 8 + 8
      this.state.cursor.column = clamp(next, 0, this.state.columns - 1)
    }
    return [this.cursorUpdate()]
  }

  private clearFromCursor(): TerminalUpdate[] {
    const cells: CellDelta[] = []
    const startRow = this.state.cursor.row
    const startColumn = this.state.cursor.column

    for (let column = startColumn; column < this.state.columns; column += 1) {
      const cell = blankCell(this.state.attributes)
      setCell(this.state, startRow, column, cell)
      cells.push({ row: startRow, column, cell })
    }

    for (let row = startRow + 1; row < this.state.rows; row += 1) {
      for (let column = 0; column < this.state.columns; column += 1) {
        const cell = blankCell(this.state.attributes)
        setCell(this.state, row, column, cell)
        cells.push({ row, column, cell })
      }
    }

    if (cells.length === 0) {
      return []
    }

    return [
      { type: 'cells', cells },
      { type: 'clear', scope: 'display-after-cursor' },
    ]
  }

  private saveCursor(): TerminalUpdate[] {
    this.state.savedCursor = { ...this.state.cursor }
    this.state.savedAttributes = cloneAttributes(this.state.attributes)
    return []
  }

  private restoreCursor(): TerminalUpdate[] {
    if (!this.state.savedCursor || !this.state.savedAttributes) {
      return []
    }
    this.state.cursor = { ...this.state.savedCursor }
    this.state.attributes = cloneAttributes(this.state.savedAttributes)
    return [
      this.cursorUpdate(),
      { type: 'attributes', attributes: this.state.attributes },
    ]
  }

  private withinScrollRegion(row: number): boolean {
    return row >= this.state.scrollTop && row <= this.state.scrollBottom
  }

  private clampCursorRow(): void {
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1
    this.state.cursor.row = clamp(this.state.cursor.row, minRow, maxRow)
  }

  private cursorUpdate(): TerminalUpdate {
    return {
      type: 'cursor',
      position: { ...this.state.cursor },
    }
  }
}

export const createInterpreter = (
  options?: InterpreterOptions,
): TerminalInterpreter => new TerminalInterpreter(options)
