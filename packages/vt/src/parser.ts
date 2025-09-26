import { Parser, ParserEventSink, ParserState } from "./types";
import { createInitialContext } from "./internal/context";

class ParserImpl implements Parser {
  private context = createInitialContext();

  get state(): ParserState {
    return this.context.state;
  }

  private readonly encoder = new TextEncoder();

  write(input: Uint8Array | string, _sink: ParserEventSink): void {
    const _buffer =
      typeof input === "string" ? this.encoder.encode(input) : input;
    // TODO: implement state machine in future iterations.
    void _buffer;
    throw new Error("Parser.write is not implemented yet");
  }

  reset(): void {
    this.context = createInitialContext();
  }
}

export const createParser = (): Parser => new ParserImpl();
