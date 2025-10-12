import path from 'node:path'
import { build, type InlineConfig } from 'vite'
import { test, expect } from '@playwright/test'
import { connect as connectNode } from '../src/client/node'

const packageRoot = path.resolve(__dirname, '..')
const webClientEntry = path.resolve(packageRoot, 'src/client/browser.ts')
const sshRoot = path.resolve(packageRoot, '../ssh')

let browserBundle: Promise<string> | null = null

type NimbusGlobal = {
  readonly NimbusSSHWebClient?: {
    readonly connect?: unknown
  }
}

async function compileBrowserBundle(): Promise<string> {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        {
          find: '@nimbus/ssh/client/web',
          replacement: path.resolve(sshRoot, 'src/client/web/index.ts'),
        },
        {
          find: '@nimbus/ssh',
          replacement: path.resolve(sshRoot, 'src/index.ts'),
        },
      ],
    },
    build: {
      write: false,
      target: 'es2020',
      sourcemap: false,
      emptyOutDir: false,
      lib: {
        entry: webClientEntry,
        formats: ['iife'],
        name: 'NimbusSSHWebClient',
        fileName: () => 'bundle.js',
      },
      rollupOptions: {
        external: [],
      },
    },
  }

  const result = await build(inlineConfig)
  const outputs = Array.isArray(result) ? result : [result]

  for (const output of outputs) {
    const chunk = output.output.find((asset) => asset.type === 'chunk')
    if (chunk && chunk.type === 'chunk') {
      return chunk.code
    }
  }

  throw new Error('Failed to build browser bundle for Playwright smoke test')
}

async function ensureBrowserBundle(): Promise<string> {
  if (!browserBundle) {
    browserBundle = compileBrowserBundle()
  }
  return browserBundle
}

test('browser bundle exposes connect function', async ({ page }) => {
  const bundle = await ensureBrowserBundle()
  await page.goto('https://example.com')
  await page.addScriptTag({ content: bundle })

  const hasConnect = await page.evaluate(() => {
    const global = window as unknown as NimbusGlobal
    return typeof global.NimbusSSHWebClient?.connect === 'function'
  })

  expect(hasConnect).toBe(true)
})

test('node client exports connect API', async () => {
  expect(typeof connectNode).toBe('function')
})
