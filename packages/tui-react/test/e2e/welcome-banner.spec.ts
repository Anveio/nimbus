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
