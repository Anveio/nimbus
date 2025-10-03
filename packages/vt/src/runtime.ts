import { createInterpreter, type TerminalInterpreter } from './interpreter'
import type { TerminalUpdate } from './interpreter-internals/delta'
import type { TerminalState } from './interpreter-internals/state'
import { createParser } from './parser'
import type {
  Parser,
  ParserEvent,
  ParserEventSink,
  ParserOptions,
  TerminalCapabilities,
  TerminalFeatures,
} from './types'
import { resolveTerminalCapabilities } from './utils/resolve-capabilities'
import type { PrinterController } from './utils/printer'

export interface TerminalRuntimeOptions
  extends Partial<Omit<TerminalCapabilities, 'features'>> {
  readonly features?: Partial<TerminalFeatures>
  readonly parser?: ParserOptions
  readonly printer?: PrinterController
}

export interface TerminalRuntime {
  readonly interpreter: TerminalInterpreter
  readonly parser: Parser
  readonly snapshot: TerminalState
  write(input: string | Uint8Array): TerminalUpdate[]
  writeBytes(input: Uint8Array): TerminalUpdate[]
  handleEvents(events: Iterable<ParserEvent>): TerminalUpdate[]
  reset(): void
}

class TerminalRuntimeImpl implements TerminalRuntime {
  readonly interpreter: TerminalInterpreter
  readonly parser: Parser

  constructor(options: TerminalRuntimeOptions) {
    const resolved = resolveTerminalCapabilities({
      parser: options.parser,
      spec: options.spec,
      emulator: options.emulator,
      features: options.features,
    })

    this.parser = createParser(resolved.parser)

    const capabilities: TerminalCapabilities = resolved.capabilities

    this.interpreter = createInterpreter({
      parser: resolved.parser,
      capabilities,
      printer: options.printer,
    })
  }

  get snapshot(): TerminalState {
    return this.interpreter.snapshot
  }

  write(input: string | Uint8Array): TerminalUpdate[] {
    return this.processWrite(input)
  }

  writeBytes(input: Uint8Array): TerminalUpdate[] {
    return this.processWrite(input)
  }

  handleEvents(events: Iterable<ParserEvent>): TerminalUpdate[] {
    return this.interpreter.handleEvents(events)
  }

  reset(): void {
    this.parser.reset()
    this.interpreter.reset()
  }

  private processWrite(input: string | Uint8Array): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    const sink: ParserEventSink = {
      onEvent: (event) => {
        const eventUpdates = this.interpreter.handleEvent(event)
        if (eventUpdates.length > 0) {
          updates.push(...eventUpdates)
        }
      },
    }
    this.parser.write(input, sink)
    return updates
  }
}

export const createTerminalRuntime = (
  options: TerminalRuntimeOptions = {},
): TerminalRuntime => new TerminalRuntimeImpl(options)

export const parser = {
  create: createParser,
} as const
