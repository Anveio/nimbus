import {
  createInterpreter,
  type SelectionPoint,
  type TerminalInterpreter,
  type TerminalSelection,
} from './interpreter'
import type { TerminalUpdate } from './interpreter-internals/delta'
import type {
  TerminalAttributes,
  TerminalState,
} from './interpreter-internals/state'
import { encodeResponsePayload } from './interpreter-internals/response'
import { createParser } from './parser'
import type {
  Parser,
  ParserEvent,
  ParserEventSink,
  ParserOptions,
  ParserSpec,
  TerminalCapabilities,
  TerminalEmulator,
  TerminalFeatures,
} from './types'
import type { PrinterController } from './utils/printer'
import { resolveTerminalCapabilities } from './utils/resolve-capabilities'

export type TerminalRuntimePresetName = 'vt220-xterm'

export interface TerminalRuntimePreset {
  readonly spec: ParserSpec
  readonly emulator?: TerminalEmulator
  readonly parser?: ParserOptions
  readonly features?: Partial<TerminalFeatures>
}

export interface TerminalRuntimeCapabilityOverrides {
  readonly spec?: ParserSpec
  readonly emulator?: TerminalEmulator
  readonly features?: Partial<TerminalFeatures>
}

export type TerminalRuntimePresetInput =
  | TerminalRuntimePresetName
  | TerminalRuntimePreset

export interface TerminalRuntimeOptions {
  readonly preset?: TerminalRuntimePresetInput
  readonly parser?: ParserOptions
  readonly capabilities?: TerminalRuntimeCapabilityOverrides
  readonly printer?: PrinterController
}

export const DEFAULT_TERMINAL_RUNTIME_PRESET_NAME: TerminalRuntimePresetName =
  'vt220-xterm'

export const TERMINAL_RUNTIME_PRESETS: Readonly<
  Record<TerminalRuntimePresetName, TerminalRuntimePreset>
> = Object.freeze({
  'vt220-xterm': Object.freeze({
    spec: 'vt220',
    emulator: 'xterm',
    parser: Object.freeze({
      spec: 'vt220',
      emulator: 'xterm',
    } satisfies ParserOptions),
  }),
})

const mergeFeatureOverrides = (
  base: Partial<TerminalFeatures> | undefined,
  overlay: Partial<TerminalFeatures> | undefined,
): Partial<TerminalFeatures> | undefined => {
  if (!base && !overlay) {
    return undefined
  }
  if (!base) {
    return overlay
  }
  if (!overlay) {
    return base
  }
  return { ...base, ...overlay }
}

const resolvePreset = (
  presetInput?: TerminalRuntimePresetInput,
): TerminalRuntimePreset => {
  if (!presetInput) {
    return TERMINAL_RUNTIME_PRESETS[DEFAULT_TERMINAL_RUNTIME_PRESET_NAME]
  }
  if (typeof presetInput === 'string') {
    const preset = TERMINAL_RUNTIME_PRESETS[presetInput]
    if (!preset) {
      throw new Error(
        `Unknown terminal runtime preset: ${presetInput as string}`,
      )
    }
    return preset
  }
  return presetInput
}

interface TerminalRuntimeInit {
  readonly parser: ParserOptions
  readonly capabilities: TerminalCapabilities
  readonly printer?: PrinterController
}

const resolveRuntimeInit = (
  options: TerminalRuntimeOptions | undefined,
): TerminalRuntimeInit => {
  const preset = resolvePreset(options?.preset)
  const overrides = options?.capabilities
  const mergedParser: ParserOptions = {
    ...(preset.parser ?? {}),
    ...(options?.parser ?? {}),
  }

  const mergedFeatures = mergeFeatureOverrides(
    preset.features,
    overrides?.features,
  )

  const finalSpec =
    overrides?.spec ??
    mergedParser.spec ??
    preset.spec

  const finalEmulator =
    overrides?.emulator ??
    mergedParser.emulator ??
    preset.emulator

  const resolved = resolveTerminalCapabilities({
    parser: mergedParser,
    spec: finalSpec,
    emulator: finalEmulator,
    features: mergedFeatures,
  })

  return {
    parser: resolved.parser,
    capabilities: resolved.capabilities,
    printer: options?.printer,
  }
}

export type TerminalRuntimeCursorMoveDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'line-start'
  | 'line-end'
  | 'word-left'
  | 'word-right'

export interface TerminalRuntimeCursorMoveOptions {
  readonly extendSelection?: boolean
  readonly selectionAnchor?: SelectionPoint | null
  readonly clampToLineEnd?: boolean
  readonly clampToContentRow?: boolean
}

export interface TerminalPointerModifierState {
  readonly shift?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
  readonly ctrl?: boolean
}

export type TerminalPointerButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'aux1'
  | 'aux2'
  | 'none'

export interface TerminalRuntimePointerEvent {
  readonly type: 'pointer'
  readonly action: 'down' | 'up' | 'move'
  readonly button: TerminalPointerButton
  readonly buttons?: number
  readonly position: { readonly row: number; readonly column: number }
  readonly modifiers?: TerminalPointerModifierState
}

export interface TerminalRuntimeWheelEvent {
  readonly type: 'wheel'
  readonly deltaY: number
  readonly deltaX?: number
  readonly position: { readonly row: number; readonly column: number }
  readonly modifiers?: TerminalPointerModifierState
}

export type TerminalRuntimeEvent =
  /**
   * Moves the cursor relative to its current position. Consumers can pass
   * optional move options to extend selections or clamp motion to content.
   */
  | {
      readonly type: 'cursor.move'
      readonly direction: TerminalRuntimeCursorMoveDirection
      readonly options?: TerminalRuntimeCursorMoveOptions
    }
  /**
   * Sets the cursor to an absolute position that has already been clamped to
   * the viewport by the caller. Optional move options control selection and
   * clamp behaviour.
   */
  | {
      readonly type: 'cursor.set'
      readonly position: { readonly row: number; readonly column: number }
      readonly options?: TerminalRuntimeCursorMoveOptions
    }
  /**
   * Replaces the runtime selection with a freshly computed range. Useful for
   * pointer gestures that start a new highlight.
   */
  | {
      readonly type: 'selection.set'
      readonly selection: TerminalSelection
    }
  /**
   * Updates an existing selection without clearing it. Ideal for drag/extend
   * flows that mutate the focus caret in place.
   */
  | {
      readonly type: 'selection.update'
      readonly selection: TerminalSelection
    }
  /**
   * Clears the active selection if present, leaving the buffer untouched.
   */
  | { readonly type: 'selection.clear' }
  /**
   * Edits the highlighted region by replacing it with the provided string. If
   * no selection is specified, the interpreter uses its current selection.
   * Optional attributes let advanced hosts override the inserted glyph style.
   */
  | {
      readonly type: 'selection.replace'
      readonly replacement: string
      readonly selection?: TerminalSelection | null
      readonly attributesOverride?: TerminalAttributes
    }
  | TerminalRuntimePointerEvent
  | TerminalRuntimeWheelEvent
  | { readonly type: 'paste'; readonly data: string }
  /**
   * Directly injects a single parser event. Reserved for advanced hosts and
   * test harnesses that already understand ECMA-48 semantics.
   */
  | { readonly type: 'parser.dispatch'; readonly event: ParserEvent }
  /**
   * Batches multiple parser events. The iterable is consumed synchronously and
   * the interpreter processes each event in order, producing a flattened list of
   * updates.
   */
  | { readonly type: 'parser.batch'; readonly events: Iterable<ParserEvent> }

export interface TerminalRuntime {
  /**
   * Advanced escape hatch exposing the underlying interpreter. Consumers should
   * prefer the runtime façade, but bespoke runtimes may rely on this to reuse
   * helper methods while the higher-level API matures.
   */
  readonly interpreter: TerminalInterpreter
  /**
   * Advanced escape hatch exposing the wired parser instance. Primarily useful
   * for instrumentation or for hosts that need to toggle parser policies at
   * runtime.
   */
  readonly parser: Parser
  /**
   * Live view over the interpreter’s mutable terminal state. Consumers should
   * treat it as read-only and rely on returned `TerminalUpdate`s to drive
   * rendering. Reads are cheap; the reference stays stable between updates.
   */
  readonly snapshot: TerminalState
  /**
   * Feeds UTF-8 text into the parser/interpreter pipeline. Use this for local
   * echo or any data already represented as a JavaScript string. The call is
   * synchronous—the parser walks the input, emits parser events, and the
   * interpreter applies them immediately. The returned updates array contains
   * only the diffs produced by this invocation. Large inputs will generate
   * proportional amounts of work, so chunk remote streams when possible.
   */
  write(input: string | Uint8Array): TerminalUpdate[]
  /**
   * Writes raw bytes directly without re-encoding. Prefer this over `write`
   * when data originates from a remote PTY or transport to avoid copies. The
   * bytes are consumed synchronously; the method returns the interpreter
   * updates triggered by the entire buffer.
   */
  writeBytes(input: Uint8Array): TerminalUpdate[]
  /**
   * Executes a single host event describing a user-facing interaction such as
   * cursor motion, selection changes, or synthetic parser commands. Downstream
   * layers should prefer this over touching the interpreter directly so that
   * future policy hooks and instrumentation can live at the runtime boundary.
   */
  dispatchEvent(event: TerminalRuntimeEvent): TerminalUpdate[]
  /**
   * Convenience wrapper that accepts an iterable of host events and executes
   * them sequentially. Updates from each event are concatenated in call order.
   * This is useful when UI layers need to coalesce multiple gestures (e.g.,
   * move cursor + set selection) while keeping diff emission synchronous.
   */
  dispatchEvents(events: Iterable<TerminalRuntimeEvent>): TerminalUpdate[]
  /**
   * Routes a single parser event straight to the interpreter. Reserved for
   * advanced callers that already speak ECMA-48 primitives (tests,
   * instrumentation tooling). Host layers should typically prefer
   * `dispatchEvent` to avoid leaking parser semantics across boundaries.
   */
  dispatchParserEvent(event: ParserEvent): TerminalUpdate[]
  /**
   * Bulk helper for advanced callers that already have an iterable of parser
   * events. Events are applied in iteration order and the resulting updates are
   * flattened into a single array. Keep the iterable finite; the runtime does
   * not buffer or throttle long-running generators.
   */
  dispatchParserEvents(events: Iterable<ParserEvent>): TerminalUpdate[]
  /**
   * Resets both parser and interpreter state to their initial capability-driven
   * snapshot. This clears scrollback, selection, and mode toggles. Invoke this
   * when a host wants to completely restart the terminal session (e.g.,
   * reconnect) without allocating a fresh runtime instance.
   */
  reset(): void
}

class TerminalRuntimeImpl implements TerminalRuntime {
  private readonly _interpreter: TerminalInterpreter
  private readonly _parser: Parser

  constructor(init: TerminalRuntimeInit) {
    this._parser = createParser(init.parser)
    this._interpreter = createInterpreter({
      parser: init.parser,
      capabilities: init.capabilities,
      printer: init.printer,
    })
  }

  get interpreter(): TerminalInterpreter {
    return this._interpreter
  }

  get parser(): Parser {
    return this._parser
  }

  get snapshot(): TerminalState {
    return this._interpreter.snapshot
  }

  write(input: string | Uint8Array): TerminalUpdate[] {
    return this.processWrite(input)
  }

  writeBytes(input: Uint8Array): TerminalUpdate[] {
    return this.processWrite(input)
  }

  dispatchEvent(event: TerminalRuntimeEvent): TerminalUpdate[] {
    switch (event.type) {
      case 'cursor.move':
        return this.handleCursorMove(event.direction, event.options)
      case 'cursor.set':
        return this._interpreter.moveCursorTo(
          event.position,
          this.normalizeCursorOptions(event.options),
        )
      case 'selection.set':
        return this._interpreter.setSelection(event.selection)
      case 'selection.update':
        return this._interpreter.updateSelection(event.selection)
      case 'selection.clear':
        return this._interpreter.clearSelection()
      case 'selection.replace':
        return this._interpreter.editSelection({
          replacement: event.replacement,
          selection: event.selection ?? undefined,
          attributesOverride: event.attributesOverride,
        })
      case 'pointer':
        return this.handlePointerEvent(event)
      case 'wheel':
        return this.handleWheelEvent(event)
      case 'paste':
        return this.handlePasteEvent(event.data)
      case 'parser.dispatch':
        return this.dispatchParserEvent(event.event)
      case 'parser.batch':
        return this.dispatchParserEvents(event.events)
      default:
        return []
    }
  }

  dispatchEvents(events: Iterable<TerminalRuntimeEvent>): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    for (const event of events) {
      const eventUpdates = this.dispatchEvent(event)
      if (eventUpdates.length > 0) {
        updates.push(...eventUpdates)
      }
    }
    return updates
  }

  dispatchParserEvent(event: ParserEvent): TerminalUpdate[] {
    return this._interpreter.handleEvent(event)
  }

  dispatchParserEvents(events: Iterable<ParserEvent>): TerminalUpdate[] {
    return this._interpreter.handleEvents(events)
  }

  reset(): void {
    this._parser.reset()
    this._interpreter.reset()
  }

  private processWrite(input: string | Uint8Array): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    const sink: ParserEventSink = {
      onEvent: (event) => {
        const eventUpdates = this._interpreter.handleEvent(event)
        if (eventUpdates.length > 0) {
          updates.push(...eventUpdates)
        }
      },
    }
    this._parser.write(input, sink)
    return updates
  }

  private handleCursorMove(
    direction: TerminalRuntimeCursorMoveDirection,
    options?: TerminalRuntimeCursorMoveOptions,
  ): TerminalUpdate[] {
    const resolvedOptions = this.normalizeCursorOptions(options)

    switch (direction) {
      case 'left':
        return this._interpreter.moveCursorLeft(resolvedOptions)
      case 'right':
        return this._interpreter.moveCursorRight(resolvedOptions)
      case 'up':
        return this._interpreter.moveCursorUp(resolvedOptions)
      case 'down':
        return this._interpreter.moveCursorDown(resolvedOptions)
      case 'line-start':
        return this._interpreter.moveCursorLineStart(resolvedOptions)
      case 'line-end':
        return this._interpreter.moveCursorLineEnd(resolvedOptions)
      case 'word-left':
        return this._interpreter.moveCursorWordLeft(resolvedOptions)
      case 'word-right':
        return this._interpreter.moveCursorWordRight(resolvedOptions)
      default:
        return []
    }
  }

  private handlePointerEvent(
    event: TerminalRuntimePointerEvent,
  ): TerminalUpdate[] {
    if (!this.supportsPointerTracking()) {
      return []
    }

    const pointerState = this.snapshot.input.pointer
    if (pointerState.tracking === 'off') {
      return []
    }

    if (event.action === 'move') {
      if (pointerState.tracking === 'button') {
        return []
      }
      const activeButtons = event.buttons ?? 0
      if (pointerState.tracking === 'normal' && activeButtons === 0) {
        return []
      }
    }

    const bytes = this.encodePointerReport(event, pointerState.encoding)
    if (!bytes) {
      return []
    }
    return this.emitHostBytes(bytes)
  }

  private handleWheelEvent(event: TerminalRuntimeWheelEvent): TerminalUpdate[] {
    if (!this.supportsPointerTracking()) {
      return []
    }
    const pointerState = this.snapshot.input.pointer
    if (pointerState.tracking === 'off') {
      return []
    }

    const sequences: TerminalUpdate[] = []
    const vertical = Math.sign(event.deltaY ?? 0)
    const horizontal = Math.sign(event.deltaX ?? 0)

    if (vertical !== 0) {
      const report = this.encodeWheelReport(
        vertical < 0 ? 'up' : 'down',
        event,
        pointerState.encoding,
      )
      if (report) {
        sequences.push(...this.emitHostBytes(report))
      }
    }

    if (horizontal !== 0) {
      const report = this.encodeWheelReport(
        horizontal < 0 ? 'left' : 'right',
        event,
        pointerState.encoding,
      )
      if (report) {
        sequences.push(...this.emitHostBytes(report))
      }
    }

    return sequences
  }

  private handlePasteEvent(data: string): TerminalUpdate[] {
    if (data.length === 0) {
      return []
    }

    const updates: TerminalUpdate[] = []
    const supportsBracketed = this.supportsBracketedPaste()
    const bracketedEnabled =
      supportsBracketed && this.snapshot.input.bracketedPaste

    if (bracketedEnabled) {
      updates.push(...this.emitHostSequence('\u001B[200~'))
    }

    updates.push(...this.processWrite(data))

    if (bracketedEnabled) {
      updates.push(...this.emitHostSequence('\u001B[201~'))
    }

    return updates
  }

  private supportsPointerTracking(): boolean {
    return this._interpreter.capabilities.features.supportsPointerTracking
  }

  private supportsBracketedPaste(): boolean {
    return this._interpreter.capabilities.features.supportsBracketedPaste
  }

  private emitHostSequence(sequence: string): TerminalUpdate[] {
    const mode = this.snapshot.c1Transmission
    const data = encodeResponsePayload(sequence, mode)
    return [{ type: 'response', data }]
  }

  private emitHostBytes(bytes: Uint8Array): TerminalUpdate[] {
    return [{ type: 'response', data: bytes }]
  }

  private encodePointerReport(
    event: TerminalRuntimePointerEvent,
    encoding: 'default' | 'utf8' | 'sgr',
  ): Uint8Array | null {
    const column = this.clampPointerCoordinate(event.position.column, encoding)
    const row = this.clampPointerCoordinate(event.position.row, encoding)
    const modifiers = this.computePointerModifierMask(event.modifiers)
    const primaryButton = this.resolvePrimaryPointerButton(
      event.button,
      event.buttons,
    )

    switch (encoding) {
      case 'sgr':
        return this.encodePointerReportSgr(
          event,
          modifiers,
          primaryButton,
          column,
          row,
        )
      case 'utf8':
        return this.encodePointerReportUtf8(
          event,
          modifiers,
          primaryButton,
          column,
          row,
        )
      default:
        return this.encodePointerReportDefault(
          event,
          modifiers,
          primaryButton,
          column,
          row,
        )
    }
  }

  private encodePointerReportDefault(
    event: TerminalRuntimePointerEvent,
    modifierMask: number,
    primaryButton: number | null,
    column: number,
    row: number,
  ): Uint8Array | null {
    const base = this.computePointerBaseCode(
      event,
      primaryButton,
      modifierMask,
      false,
    )
    if (base === null) {
      return null
    }
    const prefix = this.getCsiPrefixBytes()
    const payload = new Uint8Array(prefix.length + 4)
    payload.set(prefix, 0)
    payload[prefix.length] = 0x4d
    payload[prefix.length + 1] = 32 + base
    payload[prefix.length + 2] = 32 + Math.min(column, 223)
    payload[prefix.length + 3] = 32 + Math.min(row, 223)
    return payload
  }

  private encodePointerReportUtf8(
    event: TerminalRuntimePointerEvent,
    modifierMask: number,
    primaryButton: number | null,
    column: number,
    row: number,
  ): Uint8Array | null {
    const base = this.computePointerBaseCode(
      event,
      primaryButton,
      modifierMask,
      false,
    )
    if (base === null) {
      return null
    }
    const prefix = this.getCsiPrefixBytes()
    const cbBytes = this.encodeUtf8(32 + base)
    const columnBytes = this.encodeUtf8(32 + column)
    const rowBytes = this.encodeUtf8(32 + row)
    const payload = new Uint8Array(
      prefix.length + 1 + cbBytes.length + columnBytes.length + rowBytes.length,
    )
    payload.set(prefix, 0)
    let offset = prefix.length
    payload[offset] = 0x4d
    offset += 1
    payload.set(cbBytes, offset)
    offset += cbBytes.length
    payload.set(columnBytes, offset)
    offset += columnBytes.length
    payload.set(rowBytes, offset)
    return payload
  }

  private encodePointerReportSgr(
    event: TerminalRuntimePointerEvent,
    modifierMask: number,
    primaryButton: number | null,
    column: number,
    row: number,
  ): Uint8Array | null {
    const base = this.computePointerBaseCode(
      event,
      primaryButton,
      modifierMask,
      true,
    )
    if (base === null) {
      return null
    }
    const release = event.action === 'up'
    const final = release ? 'm' : 'M'
    const sequence = `\u001B[<${base};${column};${row}${final}`
    const mode = this.snapshot.c1Transmission
    return encodeResponsePayload(sequence, mode)
  }

  private encodeWheelReport(
    direction: 'up' | 'down' | 'left' | 'right',
    event: TerminalRuntimeWheelEvent,
    encoding: 'default' | 'utf8' | 'sgr',
  ): Uint8Array | null {
    const modifierMask = this.computePointerModifierMask(event.modifiers)
    const column = this.clampPointerCoordinate(event.position.column, encoding)
    const row = this.clampPointerCoordinate(event.position.row, encoding)
    const directionCode = this.resolveWheelCode(direction)

    switch (encoding) {
      case 'sgr': {
        const sequence = `\u001B[<${modifierMask + directionCode};${column};${row}M`
        return encodeResponsePayload(sequence, this.snapshot.c1Transmission)
      }
      case 'utf8': {
        const prefix = this.getCsiPrefixBytes()
        const buttonBytes = this.encodeUtf8(32 + modifierMask + directionCode)
        const columnBytes = this.encodeUtf8(32 + column)
        const rowBytes = this.encodeUtf8(32 + row)
        const payload = new Uint8Array(
          prefix.length +
            1 +
            buttonBytes.length +
            columnBytes.length +
            rowBytes.length,
        )
        payload.set(prefix, 0)
        let offset = prefix.length
        payload[offset] = 0x4d
        offset += 1
        payload.set(buttonBytes, offset)
        offset += buttonBytes.length
        payload.set(columnBytes, offset)
        offset += columnBytes.length
        payload.set(rowBytes, offset)
        return payload
      }
      default: {
        const prefix = this.getCsiPrefixBytes()
        const payload = new Uint8Array(prefix.length + 4)
        payload.set(prefix, 0)
        payload[prefix.length] = 0x4d
        payload[prefix.length + 1] = 32 + modifierMask + directionCode
        payload[prefix.length + 2] = 32 + Math.min(column, 223)
        payload[prefix.length + 3] = 32 + Math.min(row, 223)
        return payload
      }
    }
  }

  private computePointerBaseCode(
    event: TerminalRuntimePointerEvent,
    primaryButton: number | null,
    modifierMask: number,
    isSgr: boolean,
  ): number | null {
    switch (event.action) {
      case 'down': {
        const buttonIndex =
          this.resolveButtonIndex(event.button) ?? primaryButton ?? 0
        return modifierMask + buttonIndex
      }
      case 'up': {
        if (isSgr) {
          const buttonIndex =
            this.resolveButtonIndex(event.button) ?? primaryButton ?? 0
          return modifierMask + buttonIndex
        }
        return modifierMask + 3
      }
      case 'move': {
        const active = primaryButton ?? 3
        return modifierMask + 32 + active
      }
      default:
        return null
    }
  }

  private resolveButtonIndex(button: TerminalPointerButton): number | null {
    switch (button) {
      case 'left':
        return 0
      case 'middle':
        return 1
      case 'right':
        return 2
      case 'aux1':
        return 3
      case 'aux2':
        return 4
      default:
        return null
    }
  }

  private resolvePrimaryPointerButton(
    button: TerminalPointerButton,
    pressedMask?: number,
  ): number | null {
    const explicit = this.resolveButtonIndex(button)
    if (explicit !== null) {
      return explicit
    }
    if (!pressedMask || pressedMask === 0) {
      return null
    }
    return this.extractFirstPressedButton(pressedMask)
  }

  private extractFirstPressedButton(mask: number): number | null {
    if (mask === 0) {
      return null
    }
    for (let index = 0; index < 8; index += 1) {
      if (mask & (1 << index)) {
        return index
      }
    }
    return null
  }

  private computePointerModifierMask(
    modifiers: TerminalPointerModifierState | undefined,
  ): number {
    if (!modifiers) {
      return 0
    }
    let mask = 0
    if (modifiers.shift) {
      mask |= 4
    }
    if (modifiers.alt || modifiers.meta) {
      mask |= 8
    }
    if (modifiers.ctrl) {
      mask |= 16
    }
    return mask
  }

  private resolveWheelCode(
    direction: 'up' | 'down' | 'left' | 'right',
  ): number {
    switch (direction) {
      case 'up':
        return 64
      case 'down':
        return 65
      case 'left':
        return 66
      case 'right':
        return 67
      default:
        return 64
    }
  }

  private getCsiPrefixBytes(): number[] {
    if (this.snapshot.c1Transmission === '8-bit') {
      return [0x9b]
    }
    return [0x1b, 0x5b]
  }

  private encodeUtf8(value: number): number[] {
    if (value <= 0x7f) {
      return [value]
    }
    if (value <= 0x7ff) {
      return [0xc0 | (value >> 6), 0x80 | (value & 0x3f)]
    }
    if (value <= 0xffff) {
      return [
        0xe0 | (value >> 12),
        0x80 | ((value >> 6) & 0x3f),
        0x80 | (value & 0x3f),
      ]
    }
    return [
      0xf0 | (value >> 18),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f),
    ]
  }

  private clampPointerCoordinate(
    value: number,
    encoding: 'default' | 'utf8' | 'sgr',
  ): number {
    const min = 1
    if (!Number.isFinite(value)) {
      return min
    }
    if (encoding === 'default') {
      return Math.max(min, Math.min(Math.round(value), 223))
    }
    if (encoding === 'utf8') {
      return Math.max(min, Math.min(Math.round(value), 65535))
    }
    return Math.max(min, Math.round(value))
  }

  private normalizeCursorOptions(
    options?: TerminalRuntimeCursorMoveOptions,
  ): Required<TerminalRuntimeCursorMoveOptions> {
    return {
      extendSelection: options?.extendSelection ?? false,
      selectionAnchor: options?.selectionAnchor ?? null,
      clampToLineEnd: options?.clampToLineEnd ?? false,
      clampToContentRow: options?.clampToContentRow ?? false,
    }
  }
}

export const createTerminalRuntime = (
  options?: TerminalRuntimeOptions,
): TerminalRuntime => {
  const init = resolveRuntimeInit(options)
  return new TerminalRuntimeImpl(init)
}

export const createDefaultTerminalRuntime = (): TerminalRuntime =>
  createTerminalRuntime()

export const parser = {
  create: createParser,
} as const
