import type { Channel } from '../types'

type CloseSummary = { readonly code?: number; readonly reason?: string }

type Disposer = () => void

export interface ChannelTransport {
  readonly transport: {
    send(payload: Uint8Array): void
    onData(listener: (payload: Uint8Array) => void): Disposer
    onClose?(
      listener: (summary: CloseSummary | undefined) => void,
    ): Disposer | undefined
    onError?(listener: (error: unknown) => void): Disposer | undefined
  }
  dispose(): void
}

export interface ChannelTransportHooks {
  onSendError?(error: unknown): void
}

export function createChannelTransport(
  channel: Channel,
  hooks: ChannelTransportHooks = {},
): ChannelTransport {
  const disposers: Disposer[] = []

  const remove = (dispose: Disposer) => {
    const index = disposers.indexOf(dispose)
    if (index >= 0) {
      disposers.splice(index, 1)
    }
  }

  return {
    transport: {
      send(payload: Uint8Array) {
        void channel.send(payload).catch((error) => {
          hooks.onSendError?.(error)
        })
      },
      onData(listener) {
        const disposeStdout = channel.on('data', listener)
        const disposeStderr = channel.on('stderr', listener)
        const dispose = () => {
          disposeStdout()
          disposeStderr()
        }
        disposers.push(dispose)
        return () => {
          dispose()
          remove(dispose)
        }
      },
      onClose(listener) {
        if (!listener) {
          return undefined
        }
        const disposeExit = channel.on('exit', ({ code, sig }) => {
          listener({ code, reason: sig ? `signal:${sig}` : undefined })
        })
        const disposeError = channel.on('error', (error) => {
          listener({
            reason: error instanceof Error ? error.message : String(error),
          })
        })
        const dispose = () => {
          disposeExit()
          disposeError()
        }
        disposers.push(dispose)
        return () => {
          dispose()
          remove(dispose)
        }
      },
      onError(listener) {
        if (!listener) {
          return undefined
        }
        const dispose = channel.on('error', listener)
        disposers.push(dispose)
        return () => {
          dispose()
          remove(dispose)
        }
      },
    },
    dispose() {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        dispose?.()
      }
    },
  }
}
