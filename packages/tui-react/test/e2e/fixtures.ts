import AxeBuilder from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'
import {
  announceTerminalStatus,
  disposeHarness,
  focusTerminal,
  mountTerminal,
  prepareHarness,
  readOnDataEvents,
  resetOnDataEvents,
  warmHarnessBundle,
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

test.beforeAll(async () => {
  await warmHarnessBundle()
})

test.afterEach(async ({ page }) => {
  await resetOnDataEvents(page)
})

export { expect }
export {
  announceTerminalStatus,
  focusTerminal,
  mountTerminal,
  readOnDataEvents,
  composeTerminalText,
  writeToTerminal,
}
