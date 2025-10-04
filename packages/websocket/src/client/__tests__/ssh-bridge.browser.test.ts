import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type BrowserSshBridgeOptions, openSshSession } from '../browser'
import {
  createMockChannel,
  createMockConnection,
  flushMicrotasks as flush,
  type MockConnection,
} from './ssh-bridge.test-utils'
import type { DiagnosticEvent } from '../../protocol/diagnostics'

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

  const connectMock = vi.fn(
    async (options: {
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
    },
  )

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
    const channel = createMockChannel()
    const connection = createMockConnection(channel)

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
    const channel = createMockChannel()
    channel.overrideSend(async () => {
      throw new Error('boom')
    })
    const connection = createMockConnection(channel)

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

  it('wires connection diagnostics when requested', async () => {
    const channel = createMockChannel()
    const connection = createMockConnection(channel)
    const events: DiagnosticEvent[] = []

    const { dispose } = await openSshSession(
      connection,
      {
        target: { host: 'diag.example', port: 22 },
        user: { username: 'carol', auth: {} },
      },
      {
        onConnectionDiagnostic(event) {
          events.push(event)
        },
      },
    )

    const highEvent: DiagnosticEvent = {
      type: 'buffer_state',
      timestamp: Date.now(),
      state: 'high',
      bufferedAmount: 1024,
      threshold: 4096,
    }
    ;(connection as MockConnection).emit('diagnostic', highEvent)

    expect(events).toHaveLength(1)

    await dispose()

    const recovered: DiagnosticEvent = {
      type: 'buffer_state',
      timestamp: Date.now(),
      state: 'recovered',
      bufferedAmount: 0,
      threshold: 2048,
    }
    ;(connection as MockConnection).emit('diagnostic', recovered)

    expect(events).toHaveLength(1)
  })
})
