import {
  getSelectionRowSegments,
  type TerminalSelection,
  type TerminalState,
} from '@mana-ssh/vt'
import {
  composeTerminalText,
  expect,
  focusTerminal,
  mountTerminal,
  readOnDataEvents,
  readTerminalDiagnostics,
  resetOnDataEvents,
  test,
  writeToTerminal,
} from './fixtures'

const deriveSelectedText = (
  snapshot: TerminalState,
  selection: TerminalSelection,
): string => {
  const segments = getSelectionRowSegments(selection, snapshot.columns)
  if (segments.length === 0) {
    return ''
  }
  const lines: string[] = []
  let currentRow = segments[0]!.row
  let currentLine = ''

  const flush = () => {
    lines.push(currentLine)
    currentLine = ''
  }

  for (const segment of segments) {
    if (segment.row !== currentRow) {
      flush()
      currentRow = segment.row
    }
    const rowCells = snapshot.buffer[segment.row] ?? []
    for (
      let column = segment.startColumn;
      column <= segment.endColumn;
      column += 1
    ) {
      currentLine += rowCells[column]?.char ?? ' '
    }
  }

  flush()
  return lines.join('\n')
}

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
      .locator(
        '[data-testid="terminal-transcript"] [data-testid="terminal-transcript-row"]',
      )
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
    await expect(
      page.getByRole('textbox', { name: 'Shortcut Terminal' }),
    ).toBeFocused()
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

  test('supports keyboard selection and clipboard copy/paste', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Clipboard Terminal' })
    await focusTerminal(page)

    await page.evaluate(() => {
      const store = { value: '' }
      const originalSetData = DataTransfer.prototype.setData
      DataTransfer.prototype.setData = function setDataOverride(format, data) {
        if (format === 'text/plain' || format === 'text') {
          store.value = data ?? ''
        }
        return originalSetData.call(this, format, data)
      }
      const originalGetData = DataTransfer.prototype.getData
      DataTransfer.prototype.getData = function getDataOverride(format) {
        if (format === 'text/plain' || format === 'text') {
          return store.value
        }
        return originalGetData.call(this, format)
      }
      ;(window as any).__testClipboardStore__ = store
    })

    await writeToTerminal(page, 'ALPHA BETA')

    await page.keyboard.down('Shift')
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('ArrowLeft')
    }
    await page.keyboard.up('Shift')

    await page.waitForFunction(() => {
      const handle = window.__manaTuiReactTest__
      const selection = handle?.getSelection()
      return selection && selection.status === 'idle'
    })

    const selectionData = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      if (!handle) {
        return null
      }
      return {
        selection: handle.getSelection(),
        snapshot: handle.getSnapshot(),
      }
    })

    expect(
      selectionData,
      'selection data should be present after keyboard selection',
    ).toBeTruthy()
    const { selection, snapshot } = selectionData!
    expect(selection, 'selection handle should not be null').not.toBeNull()
    const selectedText = deriveSelectedText(snapshot!, selection!)
    expect(selectedText, `selected text mismatch (got=${selectedText})`).toBe(
      'BETA',
    )

    const copyShortcut =
      process.platform === 'darwin' ? 'Meta+C' : 'Control+Shift+C'
    const pasteShortcut =
      process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V'

    await page.evaluate(() => {
      const store = (window as any).__testClipboardStore__
      store.value = ''
    })
    await page.keyboard.press(copyShortcut)
    await page.waitForTimeout(50)
    const clipboardText = await page.evaluate(() => {
      const store = (window as any).__testClipboardStore__
      return store.value
    })
    expect(
      clipboardText,
      `clipboard should contain copied text (got=${clipboardText})`,
    ).toBe('BETA')

    const pastePayload = ' keyboard paste'
    await page.evaluate((payload) => {
      const store = (window as any).__testClipboardStore__
      store.value = payload
    }, pastePayload)
    await page.keyboard.press(pasteShortcut)
    await page.waitForTimeout(50)

    const postPaste = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(postPaste, 'snapshot should be available after paste').toBeTruthy()
    const pastedRow = postPaste!.buffer[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(
      pastedRow,
      `row after paste should contain payload (row=${pastedRow})`,
    ).toContain(`ALPHA${pastePayload}`)
  })

  test('treats raw DEL as inert while DOM Backspace erases locally', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Backspace Terminal' })
    await focusTerminal(page)

    await writeToTerminal(page, '\u001b[2J\u001b[H')
    await writeToTerminal(page, 'foo')
    await writeToTerminal(page, String.fromCharCode(0x7f))

    const afterDelSnapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(
      afterDelSnapshot,
      'snapshot should be available after DEL write',
    ).toBeTruthy()
    const afterDelRow = afterDelSnapshot!.buffer[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(afterDelRow, `DEL should not mutate row (row=${afterDelRow})`).toBe(
      'foo',
    )

    await writeToTerminal(page, '\u001b[2J\u001b[H')
    await resetOnDataEvents(page)

    await page.keyboard.type('TEST')
    await page.keyboard.press('Backspace')

    await page.waitForFunction(() => {
      const handle = window.__manaTuiReactTest__
      const snapshot = handle?.getSnapshot()
      if (!snapshot) {
        return false
      }
      const row = snapshot.buffer[0]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      return row === 'TES'
    })

    const events = await readOnDataEvents(page)
    expect(
      events.length,
      'Backspace should emit at least one onData event',
    ).toBeGreaterThan(0)
    const lastEvent = events[events.length - 1]
    expect(
      lastEvent?.bytes,
      `Backspace should emit DEL byte (event=${JSON.stringify(lastEvent)})`,
    ).toEqual([0x7f])
  })

  test('single clicks reposition the cursor within the line', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Pointer Terminal' })
    await focusTerminal(page)

    await writeToTerminal(page, 'HELLO')

    const canvas = page.locator('#terminal-harness canvas').first()
    const box = await canvas.boundingBox()
    if (!box) {
      throw new Error('Canvas bounding box unavailable')
    }

    const snapshotBefore = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    if (!snapshotBefore) {
      throw new Error('Snapshot unavailable before click')
    }

    const cellWidth = box.width / snapshotBefore.columns
    const cellHeight = box.height / snapshotBefore.rows

    await canvas.click({
      position: {
        x: box.width - cellWidth / 4,
        y: cellHeight / 2,
      },
    })

    await page.waitForFunction(() => {
      const handle = window.__manaTuiReactTest__
      const snapshot = handle?.getSnapshot()
      return snapshot?.cursor.column === 5
    })

    const snapshotAfter = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(
      snapshotAfter,
      'snapshot should be available after pointer click',
    ).toBeTruthy()
    expect(snapshotAfter!.cursor.row).toBe(0)
    expect(snapshotAfter!.cursor.column).toBe(5)
    expect(
      snapshotAfter!.selection,
      'pointer click should clear selection',
    ).toBeNull()
  })
})
