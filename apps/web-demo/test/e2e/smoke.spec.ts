import { expect, test } from '@playwright/test'

test('smoke: renders terminal shell', async ({ page }) => {
  await page.goto('/?renderer=cpu')

  const html = await page.content()
  console.log('page content after goto:', html.slice(0, 200))

  await page.getByRole('heading', { name: 'Nimbus Web Terminal' }).waitFor({
    state: 'visible',
  })

  const canvas = await page.waitForSelector('canvas', {
    state: 'attached',
    timeout: 5000,
  })
  expect(canvas).toBeTruthy()
})
