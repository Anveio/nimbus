import type {
  TerminalRuntime,
  TerminalSelection,
  TerminalUpdate,
} from '@mana/vt'
import type {
  RendererEvent,
  RuntimeUpdateBatch,
  TerminalRuntimeEvent,
} from '../types'

const CONTROL_KEYS: Record<string, string> = {
  Enter: '\r',
  Return: '\r',
  Backspace: '\u007f',
  Tab: '\t',
  Escape: '\u001b',
}

const ARROW_SEQUENCES: Record<string, string> = {
  ArrowUp: '\u001b[A',
  ArrowDown: '\u001b[B',
  ArrowRight: '\u001b[C',
  ArrowLeft: '\u001b[D',
}

const translateKeyEvent = (event: RendererEvent): string | null => {
  if (event.type !== 'runtime.key') {
    return null
  }

  if (event.ctrl && event.key.length === 1) {
    const lower = event.key.toLowerCase()
    const code = lower.charCodeAt(0)
    if (code >= 97 && code <= 122) {
      return String.fromCharCode(code - 96)
    }
    if (lower === ' ') {
      return '\u0000'
    }
  }

  const control = CONTROL_KEYS[event.key]
  if (control) {
    return event.alt ? `\u001b${control}` : control
  }

  const arrow = ARROW_SEQUENCES[event.code]
  if (arrow) {
    return arrow
  }

  if (event.key.length === 1) {
    const base = event.shift ? event.key : event.key.toLowerCase()
    return event.alt ? `\u001b${base}` : base
  }

  return null
}

const forwardRuntimeEvent = (
  runtime: TerminalRuntime,
  hostEvent: TerminalRuntimeEvent,
): ReadonlyArray<TerminalUpdate> => runtime.dispatchEvent(hostEvent)

export interface RuntimeBridgeResult {
  readonly batch: RuntimeUpdateBatch | null
  readonly handled: boolean
}

export const applyRendererEventToRuntime = (
  runtime: TerminalRuntime,
  event: RendererEvent,
): RuntimeBridgeResult => {
  switch (event.type) {
    case 'runtime.key': {
      const encoded = translateKeyEvent(event)
      if (!encoded) {
        return { batch: null, handled: false }
      }
      const updates = runtime.write(encoded)
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.text': {
      const updates = runtime.write(event.value)
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.pointer':
    case 'runtime.wheel':
    case 'runtime.copy':
    case 'runtime.paste':
    case 'runtime.focus':
    case 'runtime.blur': {
      // Pointer and clipboard events currently require host-level handling.
      // Once TerminalRuntime exposes dedicated events we will forward them.
      return { batch: null, handled: true }
    }
    case 'runtime.cursor.set': {
      const updates = forwardRuntimeEvent(runtime, {
        type: 'cursor.set',
        position: event.position,
        options: event.options,
      })
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.cursor.move': {
      const updates = forwardRuntimeEvent(runtime, {
        type: 'cursor.move',
        direction: event.direction,
        options: event.options,
      })
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.selection.set': {
      const updates = forwardRuntimeEvent(runtime, {
        type: 'selection.set',
        selection: event.selection,
      })
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.selection.update': {
      const updates = forwardRuntimeEvent(runtime, {
        type: 'selection.update',
        selection: event.selection,
      })
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.selection.clear': {
      const updates = forwardRuntimeEvent(runtime, { type: 'selection.clear' })
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.selection.replace': {
      const updates = forwardRuntimeEvent(runtime, {
        type: 'selection.replace',
        replacement: event.replacement,
        selection: event.selection ?? undefined,
        attributesOverride: event.attributesOverride,
      })
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.parser.dispatch': {
      const updates = runtime.dispatchParserEvent(event.event)
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.parser.batch': {
      const updates = runtime.dispatchParserEvents(event.events)
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.data': {
      const updates =
        typeof event.data === 'string'
          ? runtime.write(event.data)
          : runtime.writeBytes(event.data)
      return {
        batch: {
          snapshot: runtime.snapshot,
          updates,
          reason: 'apply-updates',
        },
        handled: true,
      }
    }
    case 'runtime.reset': {
      runtime.reset()
      const updates: readonly TerminalUpdate[] = []
      const snapshot = runtime.snapshot
      return {
        batch: {
          snapshot,
          updates,
          reason: 'initial',
        },
        handled: true,
      }
    }
    case 'renderer.configure':
    case 'profile.update': {
      return { batch: null, handled: false }
    }
    default: {
      const exhaustive: never = event
      return { batch: null, handled: exhaustive }
    }
  }
}

export const cloneSelection = (
  selection: TerminalSelection | null,
): TerminalSelection | null => {
  if (!selection) {
    return null
  }
  return {
    kind: selection.kind,
    status: selection.status,
    anchor: { ...selection.anchor },
    focus: { ...selection.focus },
  }
}
