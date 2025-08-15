
import { Effect, Context, Stream } from "effect"

export class Connection extends Context.Tag("Connection")<
  Connection,
  {
    readonly send: (data: string | Buffer) => Effect.Effect<void>
    readonly receive: Stream.Stream<string | Buffer>
  }
>() {}

export class Frontend extends Context.Tag("Frontend")<
  Frontend,
  {
    readonly connections: Stream.Stream<Connection>
  }
>() {}
