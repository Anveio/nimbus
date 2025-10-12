import { describe, expect, it, vi } from 'vitest'
import { connect, type NodeConnectOptions } from '../node'
import { manaV1Profile } from '../../protocol'

class MockNodeSocket {
  static instances: MockNodeSocket[] = []

  readonly sent: unknown[] = []
  readonly listeners: Record<
    'open' | 'message' | 'close' | 'error',
    Set<(event: unknown) => void>
  > = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }

  readyState = 0
  protocol = 'nimbus.ssh.v1'

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    MockNodeSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {}

  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ) {
    this.listeners[type].add(listener)
  }

  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ) {
    this.listeners[type].delete(listener)
  }

  emit(type: 'open' | 'message' | 'close' | 'error', event: unknown) {
    for (const listener of this.listeners[type]) {
      listener(event)
    }
  }
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('node connect', () => {
  it('requires explicit WebSocket implementation', async () => {
    await expect(
      connect({ url: 'wss://example', WebSocketImpl: undefined as never }),
    ).rejects.toThrow(/requires WebSocketImpl/)
  })

  it('negotiates subprotocols from profile', async () => {
    MockNodeSocket.instances.length = 0
    const options: NodeConnectOptions = {
      url: 'wss://example',
      WebSocketImpl:
        MockNodeSocket as unknown as NodeConnectOptions['WebSocketImpl'],
      profile: manaV1Profile,
    }

    const connectionPromise = connect(options)
    const socket = MockNodeSocket.instances.at(-1)!
    expect(socket.protocols).toEqual(['nimbus.ssh.v1'])

    socket.emit('open', {})
    await flushMicrotasks()
    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'hello_ok',
        server: 'node-server',
        caps: { flow: 'credit', profileAccepted: 'nimbus.v1' },
      }),
    })

    const connection = await connectionPromise
    expect(connection.protocol).toBe('nimbus.ssh.v1')
  })

  it('honours resume hooks', async () => {
    MockNodeSocket.instances.length = 0
    const persisted: unknown[] = []
    const load = vi.fn(async () => ({ token: 'node-token' }))
    let cleared = false
    const options: NodeConnectOptions = {
      url: 'wss://resume-node',
      WebSocketImpl:
        MockNodeSocket as unknown as NodeConnectOptions['WebSocketImpl'],
      resumeHooks: {
        onLoad: load,
        onPersist(state) {
          persisted.push(state)
        },
        onClear() {
          cleared = true
        },
      },
    }

    const connectionPromise = connect(options)
    const socket = MockNodeSocket.instances.at(-1)!
    socket.emit('open', {})
    await flushMicrotasks()

    expect(load).toHaveBeenCalled()

    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'hello_ok',
        server: 'node-resume',
        caps: { flow: 'credit', profileAccepted: 'nimbus.v1' },
      }),
    })

    const connection = await connectionPromise

    const sessionPromise = connection.openSession({
      target: { host: 'resume-node', port: 22 },
      user: { username: 'resumer', auth: { type: 'password' } },
    })

    const openFrame = socket.sent
      .map((item) => (typeof item === 'string' ? JSON.parse(item) : item))
      .find((item) => item && typeof item === 'object' && item.t === 'open')

    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'open_ok',
        id: openFrame?.id ?? 1,
        resumeKey: 'new-node-token',
      }),
    })
    await flushMicrotasks()

    await sessionPromise

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ token: 'new-node-token' })

    socket.emit('close', { code: 1000, reason: 'bye' })
    await flushMicrotasks()
    expect(cleared).toBe(true)

    await connection.close()
  })
})
