import { expect, test } from '@playwright/test'

const canvasSelector = 'canvas[data-testid="tui-react-canvas"]'

test.describe('TUI React harness', () => {
  test('renders renderer canvas with backend metadata', async ({ page }) => {
    page.on('console', (message) => {
      console.log(`console:${message.type()}:`, message.text())
    })
    page.on('pageerror', (error) => {
      console.log('pageerror:', error.message)
    })

    await page.goto('/')

    const initialHtml = await page.content()
    console.log('initial content preview:', initialHtml.slice(0, 200))

    await page
      .getByRole('heading', { name: 'Nimbus TUI React Harness' })
      .waitFor({
        state: 'visible',
      })

    const canvas = page.locator(canvasSelector)
    await expect(canvas).toBeVisible()

    const backend = await page.waitForFunction(() => {
      return (
        document.querySelector('canvas')?.dataset?.nimbusRendererBackend ?? null
      )
    })

    expect(await backend.jsonValue()).toBeTruthy()
  })
})
