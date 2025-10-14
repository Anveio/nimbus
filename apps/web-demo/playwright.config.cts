import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const certDir = path.join(__dirname, 'certs')
const defaultCertPath = path.join(certDir, 'localhost-cert.pem')
const defaultKeyPath = path.join(certDir, 'localhost-key.pem')

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? '3000')
const certPath = process.env.NIMBUS_DEV_CERT ?? defaultCertPath
const keyPath = process.env.NIMBUS_DEV_KEY ?? defaultKeyPath

const baseUrl = `https://${host}:${port}`
const commandArgs = [
  '--hostname',
  host,
  '--port',
  String(port),
  '--experimental-https',
  '--experimental-https-cert',
  certPath,
  '--experimental-https-key',
  keyPath,
]

function shellQuoteArgs(args: string[]): string {
  return args
    .map((arg) => {
      if (/^[A-Za-z0-9._:/-]+$/.test(arg)) {
        return arg
      }
      return `'${arg.replace(/'/g, `'\\''`)}'`
    })
    .join(' ')
}

const webServerCommand = `npm run dev:next -- ${shellQuoteArgs(commandArgs)}`

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['json', { open: 'never' }]] : [['list']],
  use: {
    baseURL: baseUrl,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: webServerCommand,
    url: baseUrl,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
  globalSetup: './test/global-setup.ts',
})
