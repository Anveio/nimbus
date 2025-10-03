import AxeBuilder from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'
import {
  announceTerminalStatus,
  disposeHarness,
  focusTerminal,
  mountTerminal,
  prepareHarness,
  readOnDataEvents,
  readFrameEvents,
  readDiagnosticsEvents,
  readCursorSelectionEvents,
  readShortcutGuideToggleEvents,
  readTerminalDiagnostics,
  resetOnDataEvents,
  resetFrameEvents,
  resetDiagnosticsEvents,
  resetCursorSelectionEvents,
  resetShortcutGuideToggleEvents,
  composeTerminalText,
  openShortcutGuide,
  closeShortcutGuide,
  toggleShortcutGuide,
  resetTerminal,
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
  await resetFrameEvents(page)
  await resetDiagnosticsEvents(page)
  await resetCursorSelectionEvents(page)
  await resetShortcutGuideToggleEvents(page)
})

export { expect }
export {
  announceTerminalStatus,
  focusTerminal,
  mountTerminal,
  readOnDataEvents,
  readFrameEvents,
  readDiagnosticsEvents,
  readCursorSelectionEvents,
  readShortcutGuideToggleEvents,
  readTerminalDiagnostics,
  composeTerminalText,
  openShortcutGuide,
  closeShortcutGuide,
  toggleShortcutGuide,
  resetTerminal,
  writeToTerminal,
  resetOnDataEvents,
  resetFrameEvents,
  resetDiagnosticsEvents,
  resetCursorSelectionEvents,
  resetShortcutGuideToggleEvents,
}
