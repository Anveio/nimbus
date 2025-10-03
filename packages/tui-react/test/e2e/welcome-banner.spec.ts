import type { Page } from '@playwright/test'
import { WELCOME_BANNER } from './banner-fixtures'
import {
  expect,
  focusTerminal,
  mountTerminal,
  test,
  writeToTerminal,
} from './fixtures'

const SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixelRatio: 0.01,
  scale: 'device' as const,
}

const _isWebglSupported = async (page: Page) => {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    return Boolean(
      canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl'),
    )
  })
}

test.describe('tui-react welcome banner rendering', () => {
  test('renders the welcome banner with the default renderer', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Welcome Banner Terminal' })
    await focusTerminal(page)

    await writeToTerminal(page, WELCOME_BANNER)
    await page.waitForTimeout(50)

    const canvas = page.locator('#terminal-harness canvas').first()
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveScreenshot(
      'welcome-banner.png',
      SCREENSHOT_OPTIONS,
    )
  })
})
