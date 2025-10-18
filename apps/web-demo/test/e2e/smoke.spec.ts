import { expect, test } from '@playwright/test'

test('smoke: renders landing page', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  if (page.url().includes('/ec2-instance-connect/')) {
    await expect(
      page.getByRole('link', { name: '← Back to instances' }),
    ).toBeVisible()
    await expect(
      page.locator('text=A connection has not been established yet.'),
    ).toBeVisible()
    return
  }

  await expect(
    page.getByRole('heading', { name: 'Nimbus Terminal Demo' }),
  ).toBeVisible()
  await expect(page.locator('main')).toBeVisible()

  const connectLink = page.getByRole('link', { name: /connect/i }).first()
  await expect(connectLink).toBeVisible()
  await connectLink.click()
  await page.waitForURL(/\/ec2-instance-connect\//)

  await expect(
    page.getByRole('link', { name: '← Back to instances' }),
  ).toBeVisible()
  await expect(
    page.locator('text=A connection has not been established yet.'),
  ).toBeVisible()
})
