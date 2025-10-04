import { test, expect } from '@playwright/test'
import { connect as connectWeb } from '../src/client/browser'

test('browser client wiring survives a browser round-trip', async ({
  page,
}) => {
  await page.goto('about:blank')

  const serializedConnect = connectWeb.toString()

  const result = await page.evaluate(async (connectSource) => {
    // biome-ignore lint/security/noGlobalEval: serialized function executed within isolated test page context
    const connect = globalThis.eval(`(${connectSource})`)

    class HarnessSocket {
      static instances = 0
      static lastHello: unknown

      readyState = 0
      protocol = 'mana.ssh.v1'
      closed = false
      listeners = {
        open: new Set(),
        message: new Set(),
        close: new Set(),
        error: new Set(),
      }

      constructor(url, protocols) {
        this.url = url
        this.protocols = protocols
        HarnessSocket.instances += 1
        queueMicrotask(() => {
          this.emit('open', {})
        })
      }

      addEventListener(type, listener) {
        this.listeners[type].add(listener)
      }

      removeEventListener(type, listener) {
        this.listeners[type].delete(listener)
      }

      emit(type, event) {
        for (const listener of this.listeners[type]) {
          listener(event)
        }
      }

      send(data) {
        HarnessSocket.lastHello = data
        const helloOk = JSON.stringify({
          t: 'hello_ok',
          server: 'browser-harness',
          caps: { flow: 'credit', profileAccepted: 'mana.v1' },
        })
        queueMicrotask(() => {
          this.emit('message', { data: helloOk })
        })
      }

      close() {
        this.closed = true
      }
    }

    const connection = await connect({
      url: 'wss://playwright.mana',
      WebSocketImpl: HarnessSocket,
    })
    await connection.close()

    return {
      instances: HarnessSocket.instances,
      hello: HarnessSocket.lastHello,
      protocol: connection.protocol,
    }
  }, serializedConnect)

  expect(result.instances).toBe(1)
  expect(typeof result.hello).toBe('string')
  expect(JSON.parse(result.hello).t).toBe('hello')
  expect(result.protocol).toBe('mana.ssh.v1')
})
