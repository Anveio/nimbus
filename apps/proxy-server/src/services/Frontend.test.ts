import { Effect, Layer, Stream, Queue, Chunk } from "effect";
import { Frontend, Connection } from "./Frontend.js";
import { FrontendLive } from "../layers/FrontendLive.js";
import { WebSocket } from "ws";
import { assert, describe, it } from "vitest";

describe("Frontend", () => {
  it("should accept connections and handle messages", () =>
    Effect.gen(function*($) {
      const frontend = yield* $(Frontend);
      const connections = frontend.connections;

      const testEffect = Effect.gen(function*($) {
        const conn = yield* $(Stream.toPull(connections), Effect.flatMap((pull) => pull));

        // Test client
        const client = new WebSocket("ws://localhost:8080");
        yield* $(Effect.async<void>((resume) => {
          client.on("open", () => resume(Effect.void));
        }));

        const messageFromClient = "hello from client";
        client.send(messageFromClient);

        const received = yield* $(conn.receive, Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual(Chunk.toReadonlyArray(received).map(b => b.toString()), [messageFromClient]);

        const messageFromServer = "hello from server";
        yield* $(conn.send(messageFromServer));

        const clientReceived = yield* $(Effect.async<string>((resume) => {
          client.on("message", (data) => resume(Effect.succeed(data.toString())));
        }));
        assert.strictEqual(clientReceived, messageFromServer);

        client.close();
        yield* $(Effect.void);
      }).pipe(Effect.scoped);

      yield* $(testEffect);
    }).pipe(Effect.provide(FrontendLive), Effect.runPromise));
});
