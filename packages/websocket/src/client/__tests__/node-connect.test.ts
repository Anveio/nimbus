import { describe, expect, it } from 'vitest'
import { connect, type NodeConnectOptions } from '../node'
import { manaV1Profile } from '../../protocol'

class MockNodeSocket {
  static instances: MockNodeSocket[] = []

  readonly sent: unknown[] = []
  readonly listeners: Record<'open' | 'message' | 'close' | 'error', Set<(event: unknown) => void>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }

  readyState = 0
  protocol = 'mana.ssh.v1'

  constructor(readonly url: string, readonly protocols?: string | string[]) {
    MockNodeSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {}

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void) {
    this.listeners[type].add(listener)
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void) {
    this.listeners[type].delete(listener)
  }

  emit(type: 'open' | 'message' | 'close' | 'error', event: unknown) {
    for (const listener of this.listeners[type]) {
      listener(event)
    }
  }
}

describe('node connect', () => {
  it('requires explicit WebSocket implementation', async () => {
    await expect(connect({ url: 'wss://example', WebSocketImpl: undefined as never })).rejects.toThrow(
      /requires WebSocketImpl/,
    )
  })

  it('negotiates subprotocols from profile', async () => {
    MockNodeSocket.instances.length = 0
    const options: NodeConnectOptions = {
      url: 'wss://example',
      WebSocketImpl: MockNodeSocket as unknown as NodeConnectOptions['WebSocketImpl'],
      profile: manaV1Profile,
    }

    const connectionPromise = connect(options)
    const socket = MockNodeSocket.instances.at(-1)!
    expect(socket.protocols).toEqual(['mana.ssh.v1'])

    socket.emit('open', {})
    await Promise.resolve()
    await Promise.resolve()
    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'hello_ok',
        server: 'node-server',
        caps: { flow: 'credit', profileAccepted: 'mana.v1' },
      }),
    })

    const connection = await connectionPromise
    expect(connection.protocol).toBe('mana.ssh.v1')
  })
})
