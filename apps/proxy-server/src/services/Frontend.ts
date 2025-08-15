
import { Effect, Context, Stream } from "effect"

export class Connection extends Context.Tag("Connection")<
  Connection,
  {
    readonly send: (data: string | Buffer) => Effect.Effect<void, Error>
    readonly receive: Stream.Stream<Buffer, Error>
  }
>() {}

export class Frontend extends Context.Tag("Frontend")<
  Frontend,
  {
    readonly connections: Stream.Stream<Connection, Error>
  }
>() {}
