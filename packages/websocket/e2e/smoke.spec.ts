import { test, expect } from '@playwright/test'
import { createBrowserWebSocketClient } from '../src/client/browser'

test('browser client wiring survives a browser round-trip', async ({ page }) => {
  await page.goto('about:blank')

  const serializedFactory = createBrowserWebSocketClient.toString()

  const result = await page.evaluate((factorySource) => {
    const createClient = globalThis.eval(`(${factorySource})`)

    class HarnessSocket {
      readonly url: string
      readonly protocols?: string | string[]
      static instances = 0
      closed = false

      constructor(url: string, protocols?: string | string[]) {
        this.url = url
        this.protocols = protocols
        HarnessSocket.instances += 1
      }

      close(): void {
        this.closed = true
      }
    }

    const client = createClient({
      url: 'wss://playwright.mana',
      protocols: ['ssh'],
      WebSocketImpl: HarnessSocket,
    })
    const socket = client.connect()
    socket.close()

    return {
      url: socket.url,
      protocols: socket.protocols,
      closed: socket.closed,
      instances: HarnessSocket.instances,
    }
  }, serializedFactory)

  expect(result).toEqual({
    url: 'wss://playwright.mana',
    protocols: ['ssh'],
    closed: true,
    instances: 1,
  })
})
