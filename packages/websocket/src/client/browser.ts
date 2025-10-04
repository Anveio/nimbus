export interface WebSocketLike {
  readonly url: string
  readonly protocols?: string | string[]
  close(code?: number, reason?: string): void
}

export interface WebSocketConstructor {
  new (url: string, protocols?: string | string[]): WebSocketLike
}

export interface BrowserWebSocketClientOptions {
  url: string
  protocols?: string | string[]
  WebSocketImpl?: WebSocketConstructor
}

export interface BrowserWebSocketClient {
  connect(): WebSocketLike
}

export const createBrowserWebSocketClient = (
  options: BrowserWebSocketClientOptions,
): BrowserWebSocketClient => {
  const { url, protocols, WebSocketImpl } = options

  const Implementation = WebSocketImpl ?? (() => {
    const globalImpl = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
    if (!globalImpl) {
      throw new Error(
        'No WebSocket implementation available. Provide WebSocketImpl when creating the client.',
      )
    }
    return globalImpl
  })()

  return {
    connect: () => new Implementation(url, protocols),
  }
}
