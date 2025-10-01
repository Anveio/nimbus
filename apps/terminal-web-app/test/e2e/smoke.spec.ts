import { expect, test } from '@playwright/test'

test('smoke: renders terminal shell', async ({ page }) => {
  await page.goto('/')

  const html = await page.content()
  console.log('page content after goto:', html.slice(0, 200))

  await page.getByRole('heading', { name: 'Mana Web Terminal' }).waitFor({
    state: 'visible',
  })

  const canvasBackend = await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.dataset?.manaRendererBackend ?? null,
    undefined,
  )

  expect(await canvasBackend.jsonValue()).toBeTruthy()
})
