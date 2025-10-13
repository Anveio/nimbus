import { expect, test } from '@playwright/test'

test('smoke: renders landing page', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Nimbus Terminal Demo' }),
  ).toBeVisible()
  await expect(page.locator('main')).toBeVisible()
})
