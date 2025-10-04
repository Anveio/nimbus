import { afterEach, describe, expect, it } from 'vitest'
import {
  createBrowserWebSocketClient,
  type BrowserWebSocketClientOptions,
} from './browser'

describe('createBrowserWebSocketClient', () => {
  const ORIGINAL_WEBSOCKET = (globalThis as { WebSocket?: unknown }).WebSocket

  afterEach(() => {
    if (ORIGINAL_WEBSOCKET === undefined) {
      delete (globalThis as { WebSocket?: unknown }).WebSocket
      return
    }
    ;(globalThis as { WebSocket?: unknown }).WebSocket = ORIGINAL_WEBSOCKET
  })

  it('creates a socket using the global WebSocket implementation', () => {
    class MockSocket {
      readonly url: string
      readonly protocols?: string | string[]

      constructor(url: string, protocols?: string | string[]) {
        this.url = url
        this.protocols = protocols
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      close(_code?: number, _reason?: string): void {}
    }

    ;(globalThis as { WebSocket?: unknown }).WebSocket = MockSocket

    const client = createBrowserWebSocketClient({
      url: 'wss://mana.test',
      protocols: ['ssh'],
    })
    const socket = client.connect()

    expect(socket).toBeInstanceOf(MockSocket)
    expect(socket.url).toBe('wss://mana.test')
    expect(socket.protocols).toEqual(['ssh'])
  })

  it('prefers an explicitly provided implementation', () => {
    const observed: Array<BrowserWebSocketClientOptions['url']> = []

    class InjectedSocket {
      readonly url: string
      readonly protocols?: string | string[]

      constructor(url: string, protocols?: string | string[]) {
        this.url = url
        this.protocols = protocols
        observed.push(url)
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      close(_code?: number, _reason?: string): void {}
    }

    const client = createBrowserWebSocketClient({
      url: 'wss://injected.test',
      protocols: 'ssh',
      WebSocketImpl: InjectedSocket,
    })

    const socket = client.connect()

    expect(socket).toBeInstanceOf(InjectedSocket)
    expect(observed).toEqual(['wss://injected.test'])
  })

  it('throws when no implementation is available', () => {
    delete (globalThis as { WebSocket?: unknown }).WebSocket

    expect(() =>
      createBrowserWebSocketClient({ url: 'wss://missing.example' }),
    ).toThrow(/No WebSocket implementation available/)
  })
})
