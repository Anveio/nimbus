import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 5173)
const HOST = '127.0.0.1'
const BASE_URL = `http://${HOST}:${PORT}`

export default defineConfig({
  testDir: './test/e2e',
  timeout: 2_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['json', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: `npm run dev -- --host ${HOST} --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 2_000,
    // Enables the window.__manaTerminalTestHandle__ hook described in docs/e2e-test-harness.md
    env: {
      VITE_E2E: '1',
    },
  },
})
