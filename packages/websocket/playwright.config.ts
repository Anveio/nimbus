import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI
    ? [['json', { outputFile: 'playwright-report.json' }]]
    : [['list']],
  retries: process.env.CI ? 2 : 0,
  use: {
    ...devices['Desktop Chrome'],
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
