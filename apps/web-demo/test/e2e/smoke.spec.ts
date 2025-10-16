import { expect, test } from '@playwright/test'

test('smoke: renders landing page', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Nimbus Terminal Demo' }),
  ).toBeVisible()
  await expect(page.locator('main')).toBeVisible()

  const connectLink = page.getByRole('link', { name: /connect/i }).first()
  await expect(connectLink).toBeVisible()
  await connectLink.click()

  await expect(page).toHaveURL(/\/ec2-instance-connect\//)
  await expect(
    page.getByRole('link', { name: '← Back to instances' }),
  ).toBeVisible()
})
