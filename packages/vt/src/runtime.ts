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
import { createParser } from './parser'
import type {
  Parser,
  ParserEvent,
  ParserEventSink,
  ParserOptions,
  TerminalCapabilities,
  TerminalFeatures,
} from './types'
import type { PrinterController } from './utils/printer'
import { resolveTerminalCapabilities } from './utils/resolve-capabilities'

export interface TerminalRuntimeOptions
  extends Partial<Omit<TerminalCapabilities, 'features'>> {
  readonly features?: Partial<TerminalFeatures>
  readonly parser?: ParserOptions
  readonly printer?: PrinterController
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

  constructor(options: TerminalRuntimeOptions) {
    const resolved = resolveTerminalCapabilities({
      parser: options.parser,
      spec: options.spec,
      emulator: options.emulator,
      features: options.features,
    })

    this._parser = createParser(resolved.parser)

    const capabilities: TerminalCapabilities = resolved.capabilities

    this._interpreter = createInterpreter({
      parser: resolved.parser,
      capabilities,
      printer: options.printer,
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
  options: TerminalRuntimeOptions = {},
): TerminalRuntime => new TerminalRuntimeImpl(options)

export const parser = {
  create: createParser,
} as const
