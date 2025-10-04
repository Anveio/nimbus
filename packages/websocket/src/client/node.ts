import type { WebSocketConstructor, WebSocketLike } from './browser'

export interface NodeWebSocketClientOptions {
  url: string
  protocols?: string | string[]
  WebSocketImpl: WebSocketConstructor
}

export interface NodeWebSocketClient {
  connect(): WebSocketLike
}

export const createNodeWebSocketClient = (
  options: NodeWebSocketClientOptions,
): NodeWebSocketClient => {
  const { url, protocols, WebSocketImpl } = options

  if (!WebSocketImpl) {
    throw new Error(
      'Node WebSocket client requires an explicit WebSocket implementation.',
    )
  }

  return {
    connect: () => new WebSocketImpl(url, protocols),
  }
}
