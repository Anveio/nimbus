import { _electron as electron, expect, test } from '@playwright/test'

test('launch electron app', async () => {
  const app = await electron.launch({
    args: ['.vite/build/main.js'],
  })

  const window = await app.firstWindow()

  // Assert "Mana" appears somewhere on the page
  await expect(window.locator('text=Hello')).toBeVisible()

  await app.close()
})
