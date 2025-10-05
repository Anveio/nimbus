import { describe, expect, it, vi } from 'vitest'
import { manaV1Profile } from '../../protocol'
import { type BrowserConnectOptions, connect } from '../browser'

class MockSocket {
  static instances: MockSocket[] = []

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
  protocol = 'mana.ssh.v1'

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    MockSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.sent.push({ type: 'close', code, reason })
  }

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

describe('browser connect', () => {
  it('performs handshake and resolves connection', async () => {
    MockSocket.instances.length = 0
    const options: BrowserConnectOptions = {
      url: 'wss://example.test/ws',
      WebSocketImpl:
        MockSocket as unknown as BrowserConnectOptions['WebSocketImpl'],
    }

    const connectionPromise = connect(options)
    const socket = MockSocket.instances.at(-1)!
    expect(socket.protocols).toEqual(['mana.ssh.v1'])

    socket.emit('open', {})
    await flushMicrotasks()

    const helloOk = manaV1Profile.encodeCtl({
      t: 'hello_ok',
      server: 'mock-server',
      caps: { flow: 'credit', profileAccepted: 'mana.v1' },
    })
    socket.emit('message', { data: helloOk })

    const connection = await connectionPromise
    expect(connection.state).toBe('ready')
    expect(connection.protocol).toBe('mana.ssh.v1')
  })

  it('opens a channel and handles data frames', async () => {
    MockSocket.instances.length = 0
    const options: BrowserConnectOptions = {
      url: 'wss://data.example/ws',
      WebSocketImpl:
        MockSocket as unknown as BrowserConnectOptions['WebSocketImpl'],
    }

    const connectionPromise = connect(options)
    const socket = MockSocket.instances.at(-1)!
    socket.emit('open', {})
    await flushMicrotasks()

    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'hello_ok',
        server: 'mock-server',
        caps: { flow: 'credit', profileAccepted: 'mana.v1' },
      }),
    })
    const connection = await connectionPromise

    const sessionPromise = connection.openSession({
      target: { host: 'demo.example', port: 22 },
      user: { username: 'alice', auth: { type: 'password' } },
      term: { cols: 80, rows: 24 },
    })

    const openFrame = JSON.parse(socket.sent.at(-1) as string)
    expect(openFrame).toMatchObject({
      t: 'open',
      target: { host: 'demo.example', port: 22 },
    })

    socket.emit('message', {
      data: manaV1Profile.encodeCtl({ t: 'open_ok', id: openFrame.id ?? 1 }),
    })

    const channel = await sessionPromise

    const received: Uint8Array[] = []
    channel.on('data', (chunk) => {
      received.push(chunk)
    })

    const dataFrames = manaV1Profile.encodeData(
      { stream: 'stdout', id: channel.id, payload: new Uint8Array([1, 2, 3]) },
      { maxFrame: 64_000 },
    )
    socket.emit('message', { data: dataFrames[0] })

    expect(received).toHaveLength(1)
    expect(Array.from(received[0]!)).toEqual([1, 2, 3])

    const flowMessage = JSON.parse(socket.sent.at(-1) as string)
    expect(flowMessage).toMatchObject({ t: 'flow', id: channel.id })

    await channel.send(new Uint8Array([9, 10]))
    const last = socket.sent.at(-1)
    expect(last).instanceOf(ArrayBuffer)
    const decoded = manaV1Profile.decodeData(last as ArrayBuffer)
    expect(decoded?.payload).toEqual(new Uint8Array([9, 10]))
  })

  it('invokes resume hooks', async () => {
    MockSocket.instances.length = 0

    const persisted: unknown[] = []
    const load = vi.fn(async () => ({ token: 'cached-token', expiresAt }))
    let cleared = false
    const expiresAt = Date.now() + 60_000
    const options: BrowserConnectOptions = {
      url: 'wss://resume.example/ws',
      WebSocketImpl:
        MockSocket as unknown as BrowserConnectOptions['WebSocketImpl'],
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
    const socket = MockSocket.instances.at(-1)!

    socket.emit('open', {})
    await flushMicrotasks()

    expect(load).toHaveBeenCalled()

    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'hello_ok',
        server: 'resume-server',
        caps: { flow: 'credit', profileAccepted: 'mana.v1' },
      }),
    })

    const connection = await connectionPromise

    const sessionPromise = connection.openSession({
      target: { host: 'resume-host', port: 22 },
      user: { username: 'resumer', auth: { type: 'password' } },
    })

    const openFrame = socket.sent
      .map((item) => (typeof item === 'string' ? JSON.parse(item) : item))
      .find((item) => item && typeof item === 'object' && item.t === 'open')

    socket.emit('message', {
      data: manaV1Profile.encodeCtl({
        t: 'open_ok',
        id: openFrame?.id ?? 1,
        resumeKey: 'fresh-token',
      }),
    })
    await flushMicrotasks()

    await sessionPromise

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ token: 'fresh-token' })

    socket.emit('close', { code: 1000, reason: 'done' })
    await flushMicrotasks()
    expect(cleared).toBe(true)

    await connection.close()
  })
})
