import AxeBuilder from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'
import {
  announceTerminalStatus,
  disposeHarness,
  focusTerminal,
  mountTerminal,
  prepareHarness,
  readOnDataEvents,
  readTerminalDiagnostics,
  resetOnDataEvents,
  composeTerminalText,
  writeToTerminal,
} from './harness-loader'

interface AxeFixture {
  readonly makeAxeBuilder: () => AxeBuilder
}

export const test = base.extend<AxeFixture>({
  page: async ({ page }, use) => {
    await prepareHarness(page)
    await use(page)
    await disposeHarness(page)
  },
  makeAxeBuilder: async ({ page }, use) => {
    await use(() => new AxeBuilder({ page }))
  },
})

test.setTimeout(10_000)

test.afterEach(async ({ page }) => {
  await resetOnDataEvents(page)
})

export { expect }
export {
  announceTerminalStatus,
  focusTerminal,
  mountTerminal,
  readOnDataEvents,
  readTerminalDiagnostics,
  composeTerminalText,
  writeToTerminal,
  resetOnDataEvents,
}
