export interface WebSocketServerLike {
  on(event: 'connection', listener: (socket: unknown) => void): void
  close(code?: number): void
}

export type WebSocketServerFactory = () => WebSocketServerLike

export interface NodeWebSocketServerOptions {
  createServer: WebSocketServerFactory
}

export interface NodeWebSocketServer {
  start(): WebSocketServerLike
}

export const createNodeWebSocketServer = (
  options: NodeWebSocketServerOptions,
): NodeWebSocketServer => {
  const { createServer } = options
  let instance: WebSocketServerLike | null = null

  return {
    start: () => {
      if (!instance) {
        instance = createServer()
      }
      return instance
    },
  }
}
