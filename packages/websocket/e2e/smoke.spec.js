const path = require('node:path')
const { buildSync } = require('esbuild')
const { test, expect } = require('@playwright/test')

const { connect: connectNode } = require('../src/client/node')

const webEntry = path.resolve(__dirname, '../src/client/browser.ts')
const webBundle = buildSync({
  entryPoints: [webEntry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  globalName: 'ManaSSHWebClient',
  sourcemap: false,
  write: false,
}).outputFiles[0]?.text

if (!webBundle) {
  throw new Error('Failed to bundle browser client for e2e test')
}

test('browser bundle exposes connect function', async ({ page }) => {
  await page.goto('https://example.com')
  await page.addScriptTag({ content: webBundle })

  const hasConnect = await page.evaluate(() => {
    return Boolean(window.ManaSSHWebClient && typeof window.ManaSSHWebClient.connect === 'function')
  })

  expect(hasConnect).toBe(true)
})

test('node client exports connect API', async () => {
  expect(typeof connectNode).toBe('function')
})
