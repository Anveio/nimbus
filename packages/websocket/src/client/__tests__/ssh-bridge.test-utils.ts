import { vi } from 'vitest'

import type { Channel, Connection } from '../types'

export interface MockChannel extends Channel {
  emit(event: 'data' | 'stderr', payload: Uint8Array): void
  emit(event: 'exit', payload: { code?: number; sig?: string }): void
  emit(event: 'error', payload: Error): void
  overrideSend(fn: (payload: Uint8Array) => Promise<void>): void
  readonly closedWith: string[]
}

export function createMockChannel(): MockChannel {
  const listeners = {
    data: new Set<(payload: Uint8Array) => void>(),
    stderr: new Set<(payload: Uint8Array) => void>(),
    exit: new Set<(payload: { code?: number; sig?: string }) => void>(),
    error: new Set<(payload: Error) => void>(),
  }
  let sendImpl: (payload: Uint8Array) => Promise<void> = async () => {}
  const closedWith: string[] = []

  const channel: Partial<MockChannel> = {
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

  return channel as MockChannel
}

export interface MockConnection extends Connection {
  emit(event: 'diagnostic', payload: unknown): void
}

export function createMockConnection(channel: MockChannel): MockConnection {
  const listeners: Record<string, Set<(payload: unknown) => void>> = {}

  const ensureBucket = (event: string): Set<(payload: unknown) => void> => {
    if (!listeners[event]) {
      listeners[event] = new Set()
    }
    return listeners[event]!
  }

  return {
    protocol: 'mana.ssh.v1',
    state: 'ready',
    on(event, listener) {
      const bucket = ensureBucket(event)
      bucket.add(listener as (payload: unknown) => void)
      return () => {
        bucket.delete(listener as (payload: unknown) => void)
      }
    },
    async openSession() {
      return channel
    },
    async close() {
      channel.closedWith.push('connection-closed')
    },
    emit(event, payload) {
      const bucket = listeners[event]
      if (!bucket) {
        return
      }
      for (const listener of bucket) {
        listener(payload)
      }
    },
  }
}
export const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
