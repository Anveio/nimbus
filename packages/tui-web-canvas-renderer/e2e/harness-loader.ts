import path from 'node:path'
import type { Page } from '@playwright/test'
import type { OutputChunk, RollupOutput } from 'rollup'
import { build, type InlineConfig } from 'vite'

const HARNESS_ENTRY = path.resolve(__dirname, 'harness.ts')

let bundlePromise: Promise<string> | null = null
const preparedPages = new WeakSet<Page>()

const createBuildConfig = (): InlineConfig => ({
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  build: {
    write: false,
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: HARNESS_ENTRY,
      formats: ['iife'],
      name: 'NimbusRendererHarness',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})

const extractBundle = (
  output: RollupOutput | RollupOutput[] | undefined,
): string => {
  const outputs = Array.isArray(output) ? output : output ? [output] : []
  for (const result of outputs) {
    for (const chunk of result.output) {
      if (chunk.type === 'chunk') {
        return (chunk as OutputChunk).code
      }
    }
  }
  throw new Error('Failed to bundle renderer harness with Vite')
}

const loadHarnessBundle = async (): Promise<string> => {
  if (!bundlePromise) {
    bundlePromise = build(createBuildConfig())
      .then((result) => extractBundle(result as RollupOutput | RollupOutput[]))
      .catch((error) => {
        bundlePromise = null
        throw error
      })
  }
  return bundlePromise
}

export const prepareHarness = async (page: Page): Promise<void> => {
  if (!preparedPages.has(page)) {
    const bundle = await loadHarnessBundle()
    await page.addInitScript({ content: bundle })
    preparedPages.add(page)
  }

  await page.goto('about:blank')
  await page.setContent('<!DOCTYPE html><html><body></body></html>')
  await page.waitForFunction(() => Boolean(window.__nimbusRendererTest__))
}

export const disposeHarness = async (page: Page): Promise<void> => {
  try {
    await page.evaluate(() => {
      window.__nimbusRendererTest__?.dispose()
    })
  } catch (error) {
    if ((error as Error).message?.includes('Target closed')) {
      return
    }
    throw error
  }
}

export const warmHarnessBundle = async (): Promise<void> => {
  await loadHarnessBundle()
}
