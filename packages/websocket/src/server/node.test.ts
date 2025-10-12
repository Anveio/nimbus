import { describe, expect, it, vi } from 'vitest'
import { createNodeWebSocketServer } from './node'
import { manaV1Profile } from '../protocol'

class MockServer {
  listeners: { connection?: (socket: MockSocket) => void } = {}

  on(event: 'connection', listener: (socket: MockSocket) => void) {
    this.listeners[event] = listener
  }

  close() {}

  connect(socket: MockSocket) {
    this.listeners.connection?.(socket)
  }
}

class MockSocket {
  readonly sent: unknown[] = []
  readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(readonly protocol: string = 'nimbus.ssh.v1') {}

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {}

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  on(type: string, listener: (event: unknown) => void) {
    this.addEventListener(type, listener)
  }

  off(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

describe('createNodeWebSocketServer', () => {
  it('creates a server instance once and reuses it', () => {
    const server = new MockServer()
    const factory = vi.fn(() => server)
    const controller = createNodeWebSocketServer({ createServer: factory })

    const first = controller.start()
    const second = controller.start()

    expect(first).toBe(server)
    expect(second).toBe(server)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('handshakes and responds to channel open with flow-aware queueing', async () => {
    const server = new MockServer()
    const controller = createNodeWebSocketServer({
      createServer: () => server,
      serverName: 'unit-test-server',
      onChannelOpen: (_request, api) => {
        api.write(new Uint8Array([1, 2, 3]))
        api.write(new Uint8Array([4, 5]))
      },
    })

    controller.start()

    const socket = new MockSocket()
    server.connect(socket)

    socket.emit('message', {
      data: JSON.stringify({
        t: 'hello',
        proto: 1,
        caps: { profile: 'nimbus.v1' },
      }),
    })

    const helloOk = JSON.parse(socket.sent.at(-1) as string)
    expect(helloOk).toMatchObject({ t: 'hello_ok', server: 'unit-test-server' })

    socket.emit('message', {
      data: JSON.stringify({
        t: 'open',
        id: 1,
        target: { host: 'demo', port: 22 },
        user: { username: 'alice', auth: {} },
      }),
    })

    const openOk = JSON.parse(socket.sent.at(-1) as string)
    expect(openOk).toMatchObject({ t: 'open_ok', id: 1 })

    const channelFramesBeforeCredit = socket.sent.filter(
      (frame) => frame instanceof ArrayBuffer,
    )
    expect(channelFramesBeforeCredit).toHaveLength(0)

    socket.emit('message', {
      data: JSON.stringify({ t: 'flow', id: 1, credit: 4 }),
    })

    const firstFrame = socket.sent.find(
      (frame) => frame instanceof ArrayBuffer,
    ) as ArrayBuffer
    const decoded = manaV1Profile.decodeData(firstFrame)
    expect(decoded?.payload).toEqual(new Uint8Array([1, 2, 3]))

    socket.emit('message', {
      data: JSON.stringify({ t: 'flow', id: 1, credit: 2 }),
    })

    const frames = socket.sent.filter((frame) => frame instanceof ArrayBuffer)
    expect(frames).toHaveLength(2)
    const secondDecoded = manaV1Profile.decodeData(frames.at(-1) as ArrayBuffer)
    expect(secondDecoded?.payload).toEqual(new Uint8Array([4, 5]))
  })
})
