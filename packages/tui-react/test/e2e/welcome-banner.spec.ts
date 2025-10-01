import type { Page } from '@playwright/test'
import {
  expect,
  focusTerminal,
  mountTerminal,
  test,
  writeToTerminal,
} from './fixtures'
import { WELCOME_BANNER } from './banner-fixtures'

const SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixelRatio: 0.01,
  scale: 'device' as const,
}

const isWebglSupported = async (page: Page) => {
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
  test('renders the welcome banner with the default renderer', async ({ page }) => {
    await mountTerminal(page, { ariaLabel: 'Welcome Banner Terminal' })
    await focusTerminal(page)

    await writeToTerminal(page, WELCOME_BANNER)
    await page.waitForTimeout(50)

    const canvas = page.locator('#terminal-harness canvas').first()
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveScreenshot('welcome-banner.png', SCREENSHOT_OPTIONS)
  })

  test('renders the welcome banner with the WebGL renderer', async ({ page }) => {
    const supportsWebgl = await isWebglSupported(page)
    test.skip(!supportsWebgl, 'WebGL not supported in this environment')

    await mountTerminal(page, {
      ariaLabel: 'Welcome Banner WebGL Terminal',
      rendererBackend: 'gpu-webgl',
    })
    await focusTerminal(page)

    await writeToTerminal(page, WELCOME_BANNER)
    await page.waitForTimeout(50)

    const backend = await page.evaluate(() => {
      const activeCanvas = document.querySelector('canvas') as HTMLCanvasElement | null
      return activeCanvas?.dataset?.manaRendererBackend ?? null
    })
    test.skip(backend !== 'gpu-webgl', `GPU backend not active (${backend ?? 'none'})`)

    const canvas = page.locator('#terminal-harness canvas').first()
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveScreenshot(
      'welcome-banner-webgl.png',
      SCREENSHOT_OPTIONS,
    )
  })
})
