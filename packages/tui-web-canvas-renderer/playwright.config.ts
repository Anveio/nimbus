import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const HARNESS_BUNDLE = path.resolve(
  __dirname,
  'test/playwright/dist/harness.js',
)

export default defineConfig({
  testDir: './test/playwright',
  timeout: 5_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['json', { outputFile: 'playwright-report.json' }]]
    : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './test/playwright/global-setup.ts',
  metadata: {
    harnessBundle: HARNESS_BUNDLE,
  },
})
