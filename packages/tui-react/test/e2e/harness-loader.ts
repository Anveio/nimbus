import path from 'node:path'
import type { CanvasRendererDiagnostics } from '@mana/tui-web-canvas-renderer'
import type { TerminalSelection } from '@mana/vt'
import type { Page } from '@playwright/test'
import react from '@vitejs/plugin-react'
import type { OutputChunk, RollupOutput } from 'rollup'
import { build, type InlineConfig, type PluginOption } from 'vite'
import type {
  TerminalFrameEvent,
  TerminalStatusMessage,
} from '../../src/Terminal'
import type {
  TerminalHarnessMountOptions,
  TerminalHarnessOnDataEvent,
  TerminalHarnessShortcutGuideToggleEvent,
} from './harness-types'

const HARNESS_ENTRY = path.resolve(__dirname, 'harness.tsx')

let bundlePromise: Promise<string> | null = null
const preparedPages = new WeakSet<Page>()

const createBuildConfig = (): InlineConfig => ({
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  define: {
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
  plugins: [react({ include: /\.(js|jsx|ts|tsx)$/ }) as PluginOption],
  build: {
    write: false,
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: HARNESS_ENTRY,
      formats: ['iife'],
      name: 'ManaTuiReactHarness',
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
  throw new Error('Failed to bundle tui-react harness with Vite')
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

export const warmHarnessBundle = async (): Promise<void> => {
  await loadHarnessBundle()
}

export const prepareHarness = async (page: Page): Promise<void> => {
  if (!preparedPages.has(page)) {
    const bundle = await loadHarnessBundle()
    await page.addInitScript({ content: bundle })
    preparedPages.add(page)
  }

  await page.goto('about:blank')
  await page.setContent('<!DOCTYPE html><html><body></body></html>')
  await page.waitForFunction(() => Boolean(window.__manaTuiReactTest__))
}

export const disposeHarness = async (page: Page): Promise<void> => {
  try {
    await page.evaluate(() => {
      window.__manaTuiReactTest__?.dispose()
    })
  } catch (error) {
    if ((error as Error).message?.includes('Target closed')) {
      return
    }
    throw error
  }
}

export const mountTerminal = async (
  page: Page,
  options?: TerminalHarnessMountOptions,
): Promise<void> => {
  await page.evaluate(
    (mountOptions) => window.__manaTuiReactTest__?.mount(mountOptions),
    options ?? {},
  )
}

export const focusTerminal = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.focus()
  })
}

export const writeToTerminal = async (
  page: Page,
  data: string,
): Promise<void> => {
  await page.evaluate((input) => {
    window.__manaTuiReactTest__?.write(input ?? '')
  }, data)
}

export const composeTerminalText = async (
  page: Page,
  data: string,
): Promise<void> => {
  await page.evaluate((input) => {
    window.__manaTuiReactTest__?.compose(input ?? '')
  }, data)
}

export const readOnDataEvents = async (
  page: Page,
): Promise<TerminalHarnessOnDataEvent[]> =>
  page.evaluate(() => window.__manaTuiReactTest__?.getOnDataEvents() ?? [])

export const readTerminalDiagnostics = async (
  page: Page,
): Promise<CanvasRendererDiagnostics | null> =>
  page.evaluate(() => window.__manaTuiReactTest__?.getDiagnostics() ?? null)

export const resetOnDataEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.resetOnDataEvents()
  })
}

export const readFrameEvents = async (
  page: Page,
): Promise<TerminalFrameEvent[]> =>
  page.evaluate(() => window.__manaTuiReactTest__?.getFrameEvents() ?? [])

export const resetFrameEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.resetFrameEvents()
  })
}

export const readDiagnosticsEvents = async (
  page: Page,
): Promise<CanvasRendererDiagnostics[]> =>
  page.evaluate(() => window.__manaTuiReactTest__?.getDiagnosticsEvents() ?? [])

export const resetDiagnosticsEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.resetDiagnosticsEvents()
  })
}

export const readCursorSelectionEvents = async (
  page: Page,
): Promise<Array<TerminalSelection | null>> =>
  page.evaluate(
    () => window.__manaTuiReactTest__?.getCursorSelectionEvents() ?? [],
  )

export const resetCursorSelectionEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.resetCursorSelectionEvents()
  })
}

export const readShortcutGuideToggleEvents = async (
  page: Page,
): Promise<TerminalHarnessShortcutGuideToggleEvent[]> =>
  page.evaluate(
    () => window.__manaTuiReactTest__?.getShortcutGuideToggleEvents() ?? [],
  )

export const resetShortcutGuideToggleEvents = async (
  page: Page,
): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.resetShortcutGuideToggleEvents()
  })
}

export const announceTerminalStatus = async (
  page: Page,
  message: TerminalStatusMessage,
): Promise<void> => {
  await page.evaluate((detail) => {
    window.__manaTuiReactTest__?.announceStatus(detail)
  }, message)
}

export const openShortcutGuide = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.openShortcutGuide()
  })
}

export const closeShortcutGuide = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.closeShortcutGuide()
  })
}

export const toggleShortcutGuide = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.toggleShortcutGuide()
  })
}

export const resetTerminal = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__manaTuiReactTest__?.resetTerminal()
  })
}
