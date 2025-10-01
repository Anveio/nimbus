import {
  expect,
  focusTerminal,
  mountTerminal,
  composeTerminalText,
  readTerminalDiagnostics,
  readOnDataEvents,
  writeToTerminal,
  test,
} from './fixtures'

test.describe('tui-react terminal', () => {
  test('renders focusable textbox with canvas output', async ({ page }) => {
    await mountTerminal(page, {
      ariaLabel: 'Playwright Terminal',
      autoFocus: false,
    })

    const container = page.getByRole('textbox', { name: 'Playwright Terminal' })
    await expect(container).toBeVisible()
    await expect(container).toHaveAttribute('tabindex', '0')

    const canvas = container.locator('canvas')
    await expect(canvas).toBeVisible()
  })

  test('emits onData events when typing characters', async ({ page }) => {
    await mountTerminal(page, { ariaLabel: 'Input Terminal' })
    await focusTerminal(page)

    await page.keyboard.type('ls')

    const events = await readOnDataEvents(page)
    expect(events.map((event) => event.text)).toEqual(['l', 's'])
    expect(events.map((event) => event.bytes)).toEqual([[108], [115]])
  })

  test('commits IME composition text and mirrors it in the transcript', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'IME Terminal' })
    await focusTerminal(page)

    await composeTerminalText(page, 'あ')

    const events = await readOnDataEvents(page)
    expect(events.map((event) => event.text)).toEqual(['あ'])

    const transcript = page
      .locator('[data-testid="terminal-transcript"] [data-testid="terminal-transcript-row"]')
      .first()
    await expect(transcript).toContainText('あ')
  })

  test('Shift + ? toggles the shortcut guide overlay', async ({ page }) => {
    await mountTerminal(page, { ariaLabel: 'Shortcut Terminal' })
    await focusTerminal(page)

    await page.keyboard.press('Shift+?')

    const dialog = page.getByRole('dialog', { name: 'Terminal shortcuts' })
    await expect(dialog).toBeVisible()

    const closeButton = dialog.getByRole('button', { name: 'Close' })
    await expect(closeButton).toBeFocused()

    await page.keyboard.press('Escape')

    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Shortcut Terminal' })).toBeFocused()
  })

  test('has no axe-core accessibility violations', async ({
    makeAxeBuilder,
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Accessible Terminal' })
    await focusTerminal(page)

    const results = await makeAxeBuilder().analyze()
    expect(results.violations).toEqual([])
  })

  test('exposes row metadata diagnostics for insert/delete sequences', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Row Metadata Terminal' })
    await focusTerminal(page)

    await writeToTerminal(page, 'abcdef')
    await writeToTerminal(page, '\u001b[3D')
    await writeToTerminal(page, '\u001b[@')
    await writeToTerminal(page, 'Z')
    await writeToTerminal(page, '\u001b[P')

    await page.waitForTimeout(0)

    const diagnostics = await readTerminalDiagnostics(page)
    test.skip(
      !diagnostics || !diagnostics.gpuRowMetadata,
      'WebGL diagnostics unavailable in this environment',
    )

    const metadata = diagnostics!.gpuRowMetadata!
    const disabledTotal =
      metadata.disabledBySelection +
      metadata.disabledByWideGlyph +
      metadata.disabledByOverlay +
      metadata.disabledByOther

    expect(metadata.rowsWithColumnOffsets).toBeGreaterThan(0)
    expect(metadata.rowsWithoutColumnOffsets).toBe(disabledTotal)
    expect(metadata.disabledBySelection).toBe(0)
    expect(metadata.disabledByWideGlyph).toBe(0)
    expect(metadata.disabledByOverlay).toBe(0)
  })
})
