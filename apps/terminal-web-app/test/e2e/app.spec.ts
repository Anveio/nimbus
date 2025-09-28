import { test, expect } from '@playwright/test'
import type { TerminalHandle } from '@mana-ssh/tui-react'
import { WELCOME_BANNER } from './fixtures/welcomeBanner'

// Scenario structure follows the guidance in docs/e2e-test-harness.md (Global harness handle)

declare global {
  interface Window {
    __manaTerminalTestHandle__?: {
      write: (input: string) => void
      getSnapshot: () => ReturnType<TerminalHandle['getSnapshot']>
    }
  }
}

test.describe('terminal e2e harness', () => {
  test('renders the welcome banner via injected bytes', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate((banner) => {
      window.__manaTerminalTestHandle__?.write(banner)
    }, WELCOME_BANNER)

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()

    await expect(canvas).toHaveScreenshot('welcome-banner.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
      scale: 'device',
    })

    const snapshot = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    expect(snapshot).toBeTruthy()
  })
})
