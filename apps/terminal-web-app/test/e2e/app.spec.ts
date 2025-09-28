import { test, expect } from '@playwright/test'

test('loads the terminal demo and accepts input', async ({ page }) => {
  await page.goto('/')

  const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
  await expect(terminal).toBeVisible()

  await terminal.click()
  await terminal.pressSequentially('hello world')
  await terminal.press('Enter')

  await expect(terminal).toBeFocused()
})
