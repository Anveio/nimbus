import { describe, expect, it } from 'vitest'
import { createNodeWebSocketClient } from './node'

describe('createNodeWebSocketClient', () => {
  it('instantiates sockets using the provided implementation', () => {
    class MockNodeSocket {
      readonly url: string
      readonly protocols?: string | string[]

      constructor(url: string, protocols?: string | string[]) {
        this.url = url
        this.protocols = protocols
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      close(_code?: number, _reason?: string): void {}
    }

    const client = createNodeWebSocketClient({
      url: 'wss://node.example',
      protocols: ['ssh'],
      WebSocketImpl: MockNodeSocket,
    })

    const socket = client.connect()
    expect(socket).toBeInstanceOf(MockNodeSocket)
    expect(socket.url).toBe('wss://node.example')
    expect(socket.protocols).toEqual(['ssh'])
  })

  it('throws when implementation is omitted', () => {
    expect(() =>
      // @ts-expect-error intentionally omitting WebSocketImpl for runtime assertion
      createNodeWebSocketClient({ url: 'wss://missing.example' }),
    ).toThrow(/requires an explicit WebSocket implementation/)
  })
})
