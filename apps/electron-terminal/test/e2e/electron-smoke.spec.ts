import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { SessionStatus } from '../../src/shared/session-types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DIST_MAIN_ENTRY = resolve(__dirname, '../../dist/main.js')

async function resolveElectronBinary(): Promise<string> {
  const electronModule = (await import('electron')) as unknown
  if (typeof electronModule === 'string') {
    return electronModule
  }
  if (typeof (electronModule as { default?: unknown }).default === 'string') {
    return (electronModule as { default: string }).default
  }
  throw new Error('Unable to resolve Electron executable path')
}

test.describe('Electron terminal shell', () => {
  test('boots and echoes through the preload bridge', async ({
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Electron harness only runs in Chromium project',
    )

    const executablePath = await resolveElectronBinary()
    const electronApp = await electron.launch({
      executablePath,
      args: [DIST_MAIN_ENTRY],
    })

    try {
      const rendererPage = await electronApp.firstWindow()
      await expect(rendererPage.locator('header')).toContainText(
        'Mana Electron Terminal',
      )
      await expect(
        rendererPage.locator('[data-testid="electron-terminal"]'),
      ).toBeVisible()

      const sentinel = 'playwright-echo-check'
      const result = await rendererPage.evaluate(async (roundtripToken) => {
        const mana = window.mana
        if (!mana) {
          throw new Error('Mana preload bridge unavailable')
        }

        const encoder = new TextEncoder()
        const decoder = new TextDecoder()
        const defaults = mana.session.getDefaultOptions()

        return await new Promise<{ status: string; echoed: string }>(
          async (resolvePromise, rejectPromise) => {
            let buffer = ''
            let settled = false

            let cleanupData: () => void = () => {}
            let cleanupStatus: () => void = () => {}

            const finalize = (payload: { status: string; echoed: string }) => {
              if (settled) {
                return
              }
              settled = true
              cleanupData()
              cleanupStatus()
              resolvePromise(payload)
            }

            const fail = (message: string) => {
              if (settled) {
                return
              }
              settled = true
              cleanupData()
              cleanupStatus()
              rejectPromise(new Error(message))
            }

            cleanupData = mana.session.onData((payload: Uint8Array) => {
              buffer += decoder.decode(payload, { stream: true })
              if (buffer.includes(roundtripToken)) {
                finalize({ status: 'ready', echoed: buffer })
              }
            })

            cleanupStatus = mana.session.onStatus((status: SessionStatus) => {
              if (status.type === 'ready') {
                mana.session.send(encoder.encode(`${roundtripToken}\r\n`))
              } else if (status.type === 'error') {
                fail(status.message ?? 'Session reported error')
              } else if (
                status.type === 'closed' &&
                status.reason !== 'session-replaced' &&
                status.reason !== 'renderer-request'
              ) {
                fail(`Session closed: ${status.reason ?? 'unknown'}`)
              }
            })

            try {
              await mana.session.close()
              await mana.session.open(defaults)
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : 'Failed to restart session'
              fail(message)
            }
          },
        )
      }, sentinel)

      expect(result.status).toBe('ready')
      expect(result.echoed).toContain('Mana Electron Terminal')
      expect(result.echoed).toContain(sentinel)
    } finally {
      await electronApp.close()
    }
  })
})
