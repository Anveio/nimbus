import {
  ServerConnection,
  type ServerConnectionOptions,
} from '../internal/connection'
export type { ServerConnectionOptions } from '../internal/connection'

export interface WebSocketServerLike {
  on(event: 'connection', listener: (socket: unknown) => void): void
  close(code?: number): void
}

export type WebSocketServerFactory = () => WebSocketServerLike

export interface NodeWebSocketServerOptions {
  createServer: WebSocketServerFactory
  serverName?: string
  maxFrame?: number
  windowTarget?: number
  onChannelOpen?: ServerConnectionOptions['onChannelOpen']
  onConnection?: (connection: ServerConnection) => void
}

export interface NodeWebSocketServer {
  start(): WebSocketServerLike
}

export const createNodeWebSocketServer = (
  options: NodeWebSocketServerOptions,
): NodeWebSocketServer => {
  const { createServer, onConnection } = options
  let instance: WebSocketServerLike | null = null

  return {
    start: () => {
      if (!instance) {
        instance = createServer()
        instance.on('connection', (socket: unknown) => {
          const connection = new ServerConnection({
            socket,
            serverName: options.serverName ?? 'nimbus.websocket.server',
            maxFrame: options.maxFrame,
            windowTarget: options.windowTarget,
            onChannelOpen: options.onChannelOpen,
          })
          onConnection?.(connection)
        })
      }
      return instance
    },
  }
}
