import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openSshSession,
  type NodeSshBridgeOptions,
} from '../node'
import {
  createMockChannel,
  createMockConnection,
  flushMicrotasks as flush,
} from './ssh-bridge.test-utils'

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

vi.mock('@mana/ssh/client/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mana/ssh/client/node')>()
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

describe('openSshSession (node)', () => {
  it('bridges channel traffic into the SSH transport', async () => {
    const channel = createMockChannel()
    const connection = createMockConnection(channel)

    const { dispose } = await openSshSession(connection, {
      target: { host: 'node.demo', port: 22 },
      user: { username: 'bob', auth: { type: 'password' } },
    })

    expect(connectMock).toHaveBeenCalledTimes(1)
    const transport = state.transport
    expect(transport).toBeDefined()
    expect(connectMock.mock.calls[0]?.[0]?.host).toEqual({
      host: 'node.demo',
      port: 22,
    })

    const payload = new Uint8Array([7, 8, 9])
    channel.emit('data', payload)
    expect(state.received).toHaveLength(1)
    expect(state.received[0]).toEqual(payload)

    const sent: Uint8Array[] = []
    channel.overrideSend(async (data) => {
      sent.push(data)
    })

    transport?.send(new Uint8Array([10, 11]))
    await flush()
    expect(sent).toHaveLength(1)

    await dispose()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(channel.closedWith).toEqual(['ssh-session-disposed'])

    channel.emit('data', new Uint8Array([1]))
    expect(state.received).toHaveLength(1)
  })

  it('emits diagnostics when channel send fails', async () => {
    const channel = createMockChannel()
    channel.overrideSend(async () => {
      throw new Error('send-failed')
    })
    const connection = createMockConnection(channel)

    const diagnostics: unknown[] = []
    const sshOptions: NodeSshBridgeOptions = {
      callbacks: {
        onDiagnostic(record: unknown) {
          diagnostics.push(record)
        },
      },
    }

    const { dispose } = await openSshSession(
      connection,
      {
        target: { host: 'node.demo', port: 22 },
        user: { username: 'bob', auth: {} },
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
