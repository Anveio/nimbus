import { Chunk, Effect, Layer, Stream } from 'effect'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import { Connection, Frontend } from '../services/Frontend.js'

export const FrontendLive = Layer.effect(
  Frontend,
  Effect.gen(function* () {
    const connections = Stream.async<Connection>((emit) => {
      const wss = new WebSocketServer({ port: 8080 })
      wss.on('connection', (ws: WebSocket) => {
        const connection = Effect.gen(function* () {
          const send = (data: string | Buffer) =>
            Effect.sync(() => ws.send(data))
          const receive = Stream.async<string | Buffer>((emit) => {
            ws.on('message', (data: RawData) => {
              emit(Effect.succeed(Chunk.of(data as Buffer)))
            })
          })
          return { send, receive }
        })
        emit(Effect.map(connection, (c) => Chunk.of(Connection.of(c))))
      })
    })
    return Frontend.of({ connections })
  }),
)
