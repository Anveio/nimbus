import {
  getSelectionRowSegments,
  type TerminalSelection,
  type TerminalState,
} from '@mana/vt'
import {
  closeShortcutGuide,
  composeTerminalText,
  expect,
  focusTerminal,
  mountTerminal,
  openShortcutGuide,
  readCursorSelectionEvents,
  readFrameEvents,
  readOnDataEvents,
  readShortcutGuideToggleEvents,
  resetFrameEvents,
  resetOnDataEvents,
  resetTerminal,
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

  test('imperative shortcut guide toggles emit instrumentation events', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Shortcut Handle Terminal' })
    await focusTerminal(page)

    const dialog = page.getByRole('dialog', { name: 'Terminal shortcuts' })
    await expect(dialog).toHaveCount(0)

    await openShortcutGuide(page)
    await expect(dialog).toBeVisible()

    await page.waitForFunction(() => {
      const events = window.__manaTuiReactTest__?.getShortcutGuideToggleEvents() ?? []
      return events.some((event) => event.visible === true)
    })

    let toggleEvents = await readShortcutGuideToggleEvents(page)
    expect(toggleEvents.length).toBeGreaterThan(0)
    expect(toggleEvents.at(-1)).toMatchObject({ visible: true, reason: 'imperative' })

    await closeShortcutGuide(page)
    await expect(dialog).toHaveCount(0)

    await page.waitForFunction(() => {
      const events = window.__manaTuiReactTest__?.getShortcutGuideToggleEvents() ?? []
      return events.some((event) => event.visible === false)
    })

    toggleEvents = await readShortcutGuideToggleEvents(page)
    expect(toggleEvents.at(-1)).toMatchObject({ visible: false, reason: 'imperative' })
  })

  test('imperative write and reset update the transcript snapshot', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Handle Terminal' })

    await writeToTerminal(page, 'hello')

    await page.waitForFunction(() => {
      const snapshot = window.__manaTuiReactTest__?.getSnapshot()
      if (!snapshot) {
        return false
      }
      const rowText = snapshot.buffer[0]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      return rowText === 'hello'
    })

    let snapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(snapshot).not.toBeNull()
    expect(
      snapshot!.buffer[0]?.map((cell) => cell?.char ?? ' ').join('').trimEnd(),
    ).toBe('hello')

    await resetTerminal(page)

    await page.waitForFunction(() => {
      const snap = window.__manaTuiReactTest__?.getSnapshot()
      if (!snap) {
        return false
      }
      const firstRow =
        snap.buffer[0]?.map((cell) => cell?.char ?? ' ').join('').trim() ?? ''
      return firstRow.length === 0 && snap.cursor.column === 0 && snap.cursor.row === 0
    })

    snapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot!.cursor.column).toBe(0)
    expect(snapshot!.cursor.row).toBe(0)
    expect(
      snapshot!.buffer[0]?.map((cell) => cell?.char ?? ' ').join('').trim(),
    ).toBe('')
  })

  test('disabling local echo preserves transcript while still emitting data', async ({
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Echo Terminal',
      localEcho: false,
    })
    await focusTerminal(page)
    await resetOnDataEvents(page)

    await page.keyboard.type('Z')

    await page.waitForFunction(() => {
      const events = window.__manaTuiReactTest__?.getOnDataEvents() ?? []
      return events.some((event) => event.text === 'Z')
    })

    const events = await readOnDataEvents(page)
    expect(events.map((event) => event.text)).toEqual(['Z'])

    const snapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    const firstRow = snapshot?.buffer?.[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(firstRow).toBe('')
  })

  test('falls back to newline when no onData handler is provided', async ({
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Fallback Terminal',
      instrumentation: { onData: false },
    })
    await focusTerminal(page)

    await page.keyboard.type('A')
    await page.keyboard.press('Enter')
    await page.keyboard.type('B')

    const events = await readOnDataEvents(page)
    expect(events).toEqual([])

    await page.waitForFunction(() => {
      const snapshot = window.__manaTuiReactTest__?.getSnapshot()
      if (!snapshot) {
        return false
      }
      const row0 = snapshot.buffer[0]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      const row1 = snapshot.buffer[1]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      return row0 === 'A' && row1 === 'B'
    })
  })

  test('autoResize recalculates rows and columns based on container size', async ({
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Auto Resize Terminal',
      autoResize: true,
    })

    const initialSnapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    if (!initialSnapshot) {
      throw new Error('Snapshot unavailable before resize')
    }

    await page.waitForTimeout(50)

    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="terminal-root"]')
      if (!root) {
        throw new Error('terminal root not found')
      }
      root.style.width = '180px'
      root.style.height = '90px'
    })

    await page.waitForFunction(
      (baseline) => {
        const snapshot = window.__manaTuiReactTest__?.getSnapshot()
        if (!snapshot) {
          return false
        }
        return (
          snapshot.columns > 0 &&
          snapshot.rows > 0 &&
          snapshot.columns < baseline.columns &&
          snapshot.rows < baseline.rows
        )
      },
      { columns: initialSnapshot.columns, rows: initialSnapshot.rows },
      { timeout: 5000 },
    )

    const snapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(snapshot?.columns).toBeLessThan(initialSnapshot.columns)
    expect(snapshot?.rows).toBeLessThan(initialSnapshot.rows)
    expect(snapshot?.columns).toBeGreaterThan(0)
    expect(snapshot?.rows).toBeGreaterThan(0)
  })

  test('manual dimensions stay constant when autoResize is disabled', async ({
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Fixed Terminal',
      rows: 30,
      columns: 100,
      autoResize: false,
    })

    await page.evaluate(() => {
      const host = document.getElementById('terminal-harness')
      if (!host) {
        throw new Error('terminal harness container not found')
      }
      host.style.width = '120px'
      host.style.height = '120px'
    })

    await page.waitForTimeout(50)

    const snapshot = await page.evaluate(() => {
      const handle = window.__manaTuiReactTest__
      return handle?.getSnapshot() ?? null
    })
    expect(snapshot?.rows).toBe(30)
    expect(snapshot?.columns).toBe(100)
  })

  test('keyboard navigation supports arrow, word, and line motions', async ({
    page,
  }) => {
    const text = 'one  two  three'
    await mountTerminal(page, {
      ariaLabel: 'Navigation Terminal',
      localEcho: false,
    })
    await writeToTerminal(page, text)
    await focusTerminal(page)

    await page.keyboard.press('Meta+ArrowLeft')

    await page.waitForFunction(() => {
      const snapshot = window.__manaTuiReactTest__?.getSnapshot()
      return snapshot?.cursor.column === 0
    })

    await page.keyboard.press('ArrowRight')

    await page.waitForFunction(
      (expected) => {
        const snapshot = window.__manaTuiReactTest__?.getSnapshot()
        return snapshot?.cursor.column === expected
      },
      1,
    )

    const wordJumpCombo = process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'
    const wordStart = text.indexOf('two')
    await page.keyboard.press(wordJumpCombo)

    await page.waitForFunction(
      (expected) => {
        const snapshot = window.__manaTuiReactTest__?.getSnapshot()
        return snapshot?.cursor.column === expected
      },
      wordStart,
    )

    await page.keyboard.press('Meta+ArrowRight')

    await page.waitForFunction(
      (expected) => {
        const snapshot = window.__manaTuiReactTest__?.getSnapshot()
        return snapshot?.cursor.column === expected
      },
      text.length,
    )
  })

  test('Delete key removes the next character locally while emitting ESC[3~', async ({
    page,
  }) => {
    await mountTerminal(page, {
      ariaLabel: 'Delete Terminal',
      localEcho: true,
    })
    await focusTerminal(page)

    await page.keyboard.type('ABCD')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')

    await resetOnDataEvents(page)
    await page.keyboard.press('Delete')

    await page.waitForFunction(() => {
      const snapshot = window.__manaTuiReactTest__?.getSnapshot()
      if (!snapshot) {
        return false
      }
      const row = snapshot.buffer[0]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      return row === 'ABD'
    })

    const events = await readOnDataEvents(page)
    expect(events.length).toBeGreaterThan(0)
    const lastBytes = events.at(-1)?.bytes ?? []
    expect(lastBytes).toEqual([0x1b, 0x5b, 0x33, 0x7e])
  })

  test('dragging across the canvas emits cursor selection instrumentation', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Selection Terminal' })
    await focusTerminal(page)

    await writeToTerminal(page, 'ALPHA BETA')

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
      throw new Error('Snapshot unavailable before drag')
    }

    const cellWidth = box.width / snapshotBefore.columns
    const cellHeight = box.height / snapshotBefore.rows

    await page.mouse.move(box.x + cellWidth * 0.5, box.y + cellHeight * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + cellWidth * 5.5, box.y + cellHeight * 0.5, {
      steps: 6,
    })
    await page.mouse.up()

    await page.waitForFunction(() => {
      const handle = window.__manaTuiReactTest__
      const selection = handle?.getSelection()
      return Boolean(selection && selection.status === 'idle')
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

    expect(selectionData).not.toBeNull()
    const selection = selectionData?.selection ?? null
    const snapshotAfter = selectionData?.snapshot ?? null
    expect(selection).not.toBeNull()
    expect(snapshotAfter).not.toBeNull()
    const selectedText =
      selection && snapshotAfter
        ? deriveSelectedText(snapshotAfter, selection)
        : ''
    expect(selectedText.trim()).toBe('ALPHA')

    const selectionEvents = await readCursorSelectionEvents(page)
    expect(selectionEvents.length).toBeGreaterThan(0)
    const lastEvent = [...selectionEvents].reverse().find((event) => event !== null)
    expect(lastEvent).not.toBeNull()
    expect(lastEvent?.status).toBe('idle')
  })

  test('frame diagnostics capture initial sync and update reasons', async ({
    page,
  }) => {
    await mountTerminal(page, { ariaLabel: 'Frame Terminal' })

    await page.waitForFunction(() => {
      const events = window.__manaTuiReactTest__?.getFrameEvents() ?? []
      return events.length > 0
    })

    const initialEvents = await readFrameEvents(page)
    expect(initialEvents.some((event) => event.reason === 'initial-sync')).toBe(true)

    await resetFrameEvents(page)
    await writeToTerminal(page, 'hi')

    await page.waitForFunction(() => {
      const events = window.__manaTuiReactTest__?.getFrameEvents() ?? []
      return events.some((event) => event.reason === 'apply-updates')
    })

    const updateEvents = await readFrameEvents(page)
    expect(updateEvents.at(-1)?.reason).toBe('apply-updates')
  })
})
