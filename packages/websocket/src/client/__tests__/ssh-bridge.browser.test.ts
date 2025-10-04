import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openSshSession,
  type BrowserSshBridgeOptions,
} from '../browser'
import type { Channel, Connection } from '../types'

const hoisted = vi.hoisted(() => {
  const disposeSpy = vi.fn()
  const state: {
    transport?: {
      send(payload: Uint8Array): void
      onData(listener: (payload: Uint8Array) => void): () => void
    }
    received: Uint8Array[]
  } = {
    transport: undefined,
    received: [],
  }

  const connectMock = vi.fn(async (options: {
    transport: {
      send(payload: Uint8Array): void
      onData(listener: (payload: Uint8Array) => void): () => void
    }
    host?: { host: string; port: number }
  }) => {
    state.transport = options.transport
    options.transport.onData((chunk) => {
      state.received.push(chunk)
    })
    return {
      session: {} as never,
      dispose: disposeSpy,
    }
  })

  return { disposeSpy, state, connectMock }
})

vi.mock('@mana/ssh/client/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mana/ssh/client/web')>()
  return {
    ...actual,
    connectSSH: hoisted.connectMock,
  }
})

const { disposeSpy, state, connectMock } = hoisted

beforeEach(() => {
  disposeSpy.mockReset()
  connectMock.mockClear()
  state.transport = undefined
  state.received.splice(0, state.received.length)
})

describe('openSshSession (browser)', () => {
  it('bridges channel traffic into the SSH transport', async () => {
    const channel = createTestChannel()
    const connection = createTestConnection(channel)

    const { dispose } = await openSshSession(connection, {
      target: { host: 'demo.example', port: 22 },
      user: { username: 'alice', auth: {} },
    })

    expect(connectMock).toHaveBeenCalledTimes(1)
    const transport = state.transport
    expect(transport).toBeDefined()
    expect(connectMock.mock.calls[0]?.[0]?.host).toEqual({
      host: 'demo.example',
      port: 22,
    })

    const payload = new Uint8Array([1, 2, 3])
    channel.emit('data', payload)
    expect(state.received).toHaveLength(1)
    expect(state.received[0]).toEqual(payload)

    const sent: Uint8Array[] = []
    channel.overrideSend(async (data) => {
      sent.push(data)
    })

    transport?.send(new Uint8Array([4, 5]))
    await flush()
    expect(sent).toHaveLength(1)

    await dispose()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(channel.closedWith).toEqual(['ssh-session-disposed'])

    channel.emit('data', new Uint8Array([9]))
    expect(state.received).toHaveLength(1)
  })

  it('emits diagnostics when channel send fails', async () => {
    const channel = createTestChannel()
    channel.overrideSend(async () => {
      throw new Error('boom')
    })
    const connection = createTestConnection(channel)

    const diagnostics: unknown[] = []
    const sshOptions: BrowserSshBridgeOptions = {
      callbacks: {
        onDiagnostic(record: unknown) {
          diagnostics.push(record)
        },
      },
    }

    const { dispose } = await openSshSession(
      connection,
      {
        target: { host: 'demo.example', port: 22 },
        user: { username: 'alice', auth: {} },
      },
      sshOptions,
    )

    state.transport?.send(new Uint8Array([1]))
    await flush()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: 'channel-send-failed' })

    await dispose()
  })
})

function createTestConnection(channel: TestChannel): Connection {
  return {
    protocol: 'mana.ssh.v1',
    state: 'ready',
    on: vi.fn(),
    async openSession() {
      return channel
    },
    async close() {
      channel.closedWith.push('connection-closed')
    },
  } as unknown as Connection
}

type TestChannel = Channel & {
  emit(event: 'data' | 'stderr', payload: Uint8Array): void
  emit(event: 'exit', payload: { code?: number; sig?: string }): void
  emit(event: 'error', payload: Error): void
  overrideSend(fn: (payload: Uint8Array) => Promise<void>): void
  closedWith: string[]
}

function createTestChannel(): TestChannel {
  const listeners = {
    data: new Set<(payload: Uint8Array) => void>(),
    stderr: new Set<(payload: Uint8Array) => void>(),
    exit: new Set<(payload: { code?: number; sig?: string }) => void>(),
    error: new Set<(payload: Error) => void>(),
  }
  let sendImpl: (payload: Uint8Array) => Promise<void> = async () => {}
  const closedWith: string[] = []

  const channel: Partial<TestChannel> = {
    id: 1,
    on(event, listener) {
      const bucket = listeners[event as keyof typeof listeners] as Set<
        (payload: unknown) => void
      >
      bucket.add(listener as (payload: unknown) => void)
      return () => bucket.delete(listener as (payload: unknown) => void)
    },
    async send(payload: Uint8Array) {
      await sendImpl(payload)
    },
    async close(reason?: string) {
      closedWith.push(reason ?? '')
    },
    resize: vi.fn(),
    signal: vi.fn(),
    emit(event, payload) {
      const bucket = listeners[event as keyof typeof listeners] as Set<
        (payload: unknown) => void
      >
      for (const listener of bucket) {
        listener(payload)
      }
    },
    overrideSend(fn: (payload: Uint8Array) => Promise<void>) {
      sendImpl = fn
    },
    closedWith,
  }

  return channel as TestChannel
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
