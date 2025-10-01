import {
  expect,
  focusTerminal,
  mountTerminal,
  readOnDataEvents,
  test,
} from './fixtures'

test.describe('tui-react terminal', () => {
  test('renders focusable textbox with canvas output', async ({ page }) => {
    await mountTerminal(page, {
      ariaLabel: 'Playwright Terminal',
      autoFocus: false,
    })

    const container = page.getByRole('textbox', { name: 'Playwright Terminal' })
    await expect(container).toBeVisible()
    await expect(container).toHaveAttribute('tabindex', '0')

    const canvas = container.locator('canvas')
    await expect(canvas).toBeVisible()
  })

  test('emits onData events when typing characters', async ({ page }) => {
    await mountTerminal(page, { ariaLabel: 'Input Terminal' })
    await focusTerminal(page)

    await page.keyboard.type('ls')

    const events = await readOnDataEvents(page)
    expect(events.map((event) => event.text)).toEqual(['l', 's'])
    expect(events.map((event) => event.bytes)).toEqual([[108], [115]])
  })

  test('has no axe-core accessibility violations', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Accessible Terminal' })
    await focusTerminal(page)

    const results = await makeAxeBuilder().analyze()
    expect(results.violations).toEqual([])
  })
})
