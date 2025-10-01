import {
  announceTerminalStatus,
  expect,
  focusTerminal,
  mountTerminal,
  test,
  writeToTerminal,
} from './fixtures'

const TEST_IDS = {
  root: 'terminal-root',
  instructions: 'terminal-instructions',
  transcript: 'terminal-transcript',
  transcriptRow: 'terminal-transcript-row',
  transcriptCell: 'terminal-transcript-cell',
  caretStatus: 'terminal-caret-status',
  statusRegion: 'terminal-status-region',
} as const

const ROOT_SELECTOR = `[data-testid="${TEST_IDS.root}"]`
const TRANSCRIPT_SELECTOR = `[data-testid="${TEST_IDS.transcript}"]`
const TRANSCRIPT_ROW_SELECTOR = `[data-testid="${TEST_IDS.transcriptRow}"]`
const TRANSCRIPT_CELL_SELECTOR = `[data-testid="${TEST_IDS.transcriptCell}"]`
const CARET_STATUS_SELECTOR = `[data-testid="${TEST_IDS.caretStatus}"]`
const STATUS_REGION_SELECTOR = `[data-testid="${TEST_IDS.statusRegion}"]`

const splitIds = (ids: string | null): string[] => {
  if (!ids) {
    return []
  }
  return ids
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

test.describe('tui-react terminal accessibility contract', () => {
  test('container exposes required ARIA semantics and instructions', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: false,
    })

    const container = page.locator(ROOT_SELECTOR)

    await expect(container).toHaveAttribute('role', 'textbox')
    await expect(container).toHaveAttribute('aria-multiline', 'true')
    await expect(container).toHaveAttribute('aria-roledescription', 'Terminal')

    const describedByIds = splitIds(await container.getAttribute('aria-describedby'))
    expect(describedByIds.length).toBeGreaterThan(0)

    for (const id of describedByIds) {
      const instructions = page.locator(`#${id}`)
      await expect(instructions).toBeAttached()
      await expect(instructions).toHaveAttribute('data-testid', TEST_IDS.instructions)
    }

    await expect(container).not.toBeFocused()

    const axeResults = await makeAxeBuilder().include(ROOT_SELECTOR).analyze()
    expect(axeResults.violations).toEqual([])
  })

  test('accessible transcript advertises live log semantics before output', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: false,
    })

    const transcript = page.locator(TRANSCRIPT_SELECTOR)
    await expect(transcript).toHaveAttribute('role', 'log')
    await expect(transcript).toHaveAttribute('aria-live', 'polite')
    await expect(transcript).toHaveAttribute('aria-atomic', 'false')
    await expect(transcript).toHaveAttribute('aria-relevant', 'additions text')

    const axeResults = await makeAxeBuilder().include(TRANSCRIPT_SELECTOR).analyze()
    expect(axeResults.violations).toEqual([])
  })

  test('streaming output updates the transcript dom mirror', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: true,
    })

    await focusTerminal(page)
    await writeToTerminal(page, 'hello world\r\nsecond line\r\n')

    const transcript = page.locator(TRANSCRIPT_SELECTOR)
    const firstRow = transcript.locator(TRANSCRIPT_ROW_SELECTOR).first()
    const secondRow = transcript.locator(TRANSCRIPT_ROW_SELECTOR).nth(1)

    await expect(firstRow).toContainText('hello world')
    await expect(secondRow).toContainText('second line')

    const axeResults = await makeAxeBuilder().include(TRANSCRIPT_SELECTOR).analyze()
    expect(axeResults.violations).toEqual([])
  })

  test('selection state is exposed via aria-selected and active descendant mapping', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: true,
    })

    await focusTerminal(page)
    await writeToTerminal(page, 'SELECTION TEST')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')

    const container = page.locator(ROOT_SELECTOR)
    const activeDescendant = await container.getAttribute('aria-activedescendant')
    expect(activeDescendant).not.toBeNull()

    if (activeDescendant) {
      const activeElement = page.locator(`#${activeDescendant}`)
      await expect(activeElement).toBeVisible()
      await expect(activeElement).toHaveAttribute('data-testid', 'terminal-transcript-cell')
    }

    const selectionState = await page.evaluate(() =>
      window.__manaTuiReactTest__?.getSelection() ?? null,
    )
    expect(selectionState).not.toBeNull()

    const selectedCell = page.locator(`${TRANSCRIPT_CELL_SELECTOR}[aria-selected="true"]`).first()
    await expect(selectedCell).toHaveAttribute('aria-selected', 'true')

    const axeResults = await makeAxeBuilder().include(TRANSCRIPT_SELECTOR).analyze()
    expect(axeResults.violations).toEqual([])
  })

  test('caret movements announce status updates through a live region', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: true,
    })

    await focusTerminal(page)
    await writeToTerminal(page, 'cursor\r\n')
    await page.keyboard.press('ArrowLeft')

    const statusRegion = page.locator(CARET_STATUS_SELECTOR)
    await expect(statusRegion).toHaveAttribute('role', 'status')
    await expect(statusRegion).toHaveAttribute('aria-live', 'polite')
    await expect(statusRegion).toContainText(/row\s+\d+/i)
    await expect(statusRegion).toContainText(/column\s+\d+/i)

    const axeResults = await makeAxeBuilder().include(CARET_STATUS_SELECTOR).analyze()
    expect(axeResults.violations).toEqual([])
  })

  test('status/notification region reports connection events accessibly', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: false,
    })

    await announceTerminalStatus(page, {
      kind: 'connection',
      level: 'error',
      message: 'Connection lost',
    })

    const statusRegion = page.locator(STATUS_REGION_SELECTOR)
    await expect(statusRegion).toHaveAttribute('role', 'status')
    await expect(statusRegion).toHaveAttribute('aria-live', 'assertive')
    await expect(statusRegion).toContainText(/connection lost/i)

    const axeResults = await makeAxeBuilder().include(STATUS_REGION_SELECTOR).analyze()
    expect(axeResults.violations).toEqual([])
  })

  test('full interaction path remains axe-clean after typing, selection, paste, and scrollback', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Accessible Terminal',
      autoFocus: true,
    })

    await focusTerminal(page)
    await writeToTerminal(page, 'history line 1\r\nhistory line 2\r\n')
    await page.keyboard.press('PageUp')
    await page.keyboard.type('echo accessible')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Control+C')
    await page.keyboard.press('Control+V')

    const axeResults = await makeAxeBuilder().analyze()
    expect(axeResults.violations).toEqual([])
  })
})
