import { describe, expect, it, vi } from 'vitest'
import { createNodeWebSocketServer } from './node'

describe('createNodeWebSocketServer', () => {
  it('creates a server instance once and reuses it', () => {
    const server = {
      on: vi.fn(),
      close: vi.fn(),
    }
    const factory = vi.fn(() => server)
    const controller = createNodeWebSocketServer({ createServer: factory })

    const first = controller.start()
    const second = controller.start()

    expect(first).toBe(server)
    expect(second).toBe(server)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
