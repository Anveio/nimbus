import { Chunk, Effect, Layer, Queue, Stream } from "effect";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { Connection, Frontend } from "../services/Frontend.js";

export const FrontendLive = Layer.scoped(
  Frontend,
  Effect.gen(function* () {
    const wss = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocketServer({ port: 8080 })).pipe(
        Effect.tap(() => Effect.log("WebSocket server started on port 8080")),
      ),
      (wss) =>
        Effect.sync(() => wss.close()).pipe(
          Effect.tap(() => Effect.log("WebSocket server closed")),
        ),
    );

    const connections = Stream.async<Connection>((emit) => {
      wss.on("connection", (ws: WebSocket) => {
        const connectionEffect = Effect.gen(function* () {
          const queue = yield* Queue.unbounded<string | Buffer>();

          ws.on("message", (data: RawData) => {
            const message =
              data instanceof Buffer
                ? data
                : Buffer.from(
                  Array.isArray(data) ? Buffer.concat(data) : data,
                );
            Queue.unsafeOffer(queue, message);
          });

          ws.on("close", () => {
            Queue.shutdown(queue);
          });

          ws.on("error", (error) => {
            Effect.runFork(emit(Effect.fail(error)));
          });

          const send = (data: string | Buffer) =>
            Effect.tryPromise({
              try: () =>
                new Promise<void>((resolve, reject) => {
                  ws.send(data, (err) => {
                    if (err) {
                      reject(err);
                    } else {
                      resolve();
                    }
                  });
                }),
              catch: (unknown) => new Error(`Failed to send message: ${unknown}`),
            });

          const receive = Stream.fromQueue(queue);

          return { send, receive };
        }).pipe(Effect.withSpan("connection"));

        emit(Effect.map(connectionEffect, (c) => Chunk.of(Connection.of(c))));
      });

      wss.on("error", (error) => {
        emit(Effect.fail(error));
      });
    });

    return Frontend.of({ connections });
  }),
);