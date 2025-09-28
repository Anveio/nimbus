import { test, expect } from '@playwright/test'
import { WELCOME_BANNER } from './fixtures/welcomeBanner'
import { acquireTerminalHarness } from './utils/harness'

test.describe('terminal e2e harness', () => {
  test('renders the welcome banner via injected bytes', async ({ page }) => {
    await page.goto('/')

    const harness = await acquireTerminalHarness(page)
    await harness.focus()
    await harness.reset()
    await harness.injectAnsi(WELCOME_BANNER)
    await harness.awaitIdle()

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()

    await expect(canvas).toHaveScreenshot('welcome-banner.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
      scale: 'device',
    })

    const snapshot = await harness.getSnapshot()
    expect(snapshot.selection).toBeNull()
  })
})
