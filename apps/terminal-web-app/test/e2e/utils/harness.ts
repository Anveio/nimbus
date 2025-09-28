import type { Page } from '@playwright/test'
import type { TerminalTestHarness } from '../../../src/testing/useTerminalTestHarness'

export interface PageTerminalHarness {
  readonly focus: () => Promise<void>
  readonly injectAnsi: (input: string) => Promise<void>
  readonly injectBytes: (input: Uint8Array) => Promise<void>
  readonly reset: () => Promise<void>
  readonly awaitIdle: () => Promise<void>
  readonly getSnapshot: () => Promise<ReturnType<TerminalTestHarness['getSnapshot']>>
  readonly getSelection: () => Promise<ReturnType<TerminalTestHarness['getSelection']>>
}

export const acquireTerminalHarness = async (
  page: Page,
): Promise<PageTerminalHarness> => {
  await page.waitForFunction(() => Boolean(window.__manaTest__))

  const focus = async () => {
    await page.evaluate(() => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      handle.focus()
    })
  }

  const injectAnsi = async (input: string) => {
    await page.evaluate((value) => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      return handle.injectAnsi(value)
    }, input)
  }

  const injectBytes = async (input: Uint8Array) => {
    const buffer = Array.from(input)
    await page.evaluate((value) => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      const bytes = new Uint8Array(value)
      return handle.injectBytes(bytes)
    }, buffer)
  }

  const reset = async () => {
    await page.evaluate(() => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      return handle.reset()
    })
  }

  const awaitIdle = async () => {
    await page.evaluate(() => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      return handle.awaitIdle()
    })
  }

  const getSnapshot = async () => {
    return await page.evaluate(() => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      return handle.getSnapshot()
    })
  }

  const getSelection = async () => {
    return await page.evaluate(() => {
      const handle = window.__manaTest__
      if (!handle) {
        throw new Error('Terminal test harness not registered')
      }
      return handle.getSelection()
    })
  }

  return {
    focus,
    injectAnsi,
    injectBytes,
    reset,
    awaitIdle,
    getSnapshot,
    getSelection,
  }
}
