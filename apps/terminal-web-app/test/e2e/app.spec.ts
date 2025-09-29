import type { TerminalHandle } from '@mana-ssh/tui-react'
import {
  getSelectionRowSegments,
  type TerminalSelection,
  type TerminalState,
} from '@mana-ssh/vt'
import { expect, test } from '@playwright/test'
import { WELCOME_BANNER } from './fixtures/welcomeBanner'

// Scenario structure follows the guidance in docs/e2e-test-harness.md (Global harness handle)

declare global {
  interface Window {
    __manaTerminalTestHandle__?: {
      write: (input: string) => void
      getSnapshot: () => ReturnType<TerminalHandle['getSnapshot']>
      getSelection: () => ReturnType<TerminalHandle['getSelection']>
    }
  }
}

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

test.describe('terminal e2e harness', () => {
  test('renders the welcome banner', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.focus()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate((banner) => {
      window.__manaTerminalTestHandle__?.write(banner)
    }, WELCOME_BANNER)

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()

    await expect(canvas).toHaveScreenshot('welcome-banner.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
      scale: 'device',
    })

    const snapshot = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    expect(snapshot).toBeTruthy()
  })

  test('supports keyboard selection and clipboard copy/paste', async ({
    page,
  }) => {
    const copyShortcut =
      process.platform === 'darwin' ? 'Meta+C' : 'Control+Shift+C'
    const pasteShortcut =
      process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V'

    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('ALPHA BETA')
    })

    await page.keyboard.down('Shift')
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('ArrowLeft')
    }
    await page.keyboard.up('Shift')

    await page.evaluate(() => window.__manaTerminalTestHandle__?.getSelection())

    await page.waitForFunction(() => {
      const handle = window.__manaTerminalTestHandle__
      const selection = handle?.getSelection()
      return selection && selection.status === 'idle'
    })

    const selectionData = await page.evaluate(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return null
      }
      return {
        selection: handle.getSelection(),
        snapshot: handle.getSnapshot(),
      }
    })

    expect(selectionData).toBeTruthy()
    const { selection, snapshot } = selectionData!
    expect(selection).toBeTruthy()
    if (!selection) {
      throw new Error('Selection was not established')
    }

    const selectedText = deriveSelectedText(snapshot, selection)
    expect(selectedText).toBe('BETA')

    await page.evaluate(async () => {
      await navigator.clipboard.writeText('')
    })
    await page.keyboard.press(copyShortcut)
    await page.waitForTimeout(50)
    const clipboardText = await page.evaluate(async () =>
      navigator.clipboard.readText(),
    )
    expect(clipboardText).toBe('BETA')

    const pastePayload = ' keyboard paste'
    await page.evaluate(async (payload) => {
      await navigator.clipboard.writeText(payload)
    }, pastePayload)
    await page.keyboard.press(pasteShortcut)
    await page.waitForTimeout(50)

    const afterPaste = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    expect(afterPaste).toBeTruthy()
    const pastedRow = afterPaste!.buffer[0]
      ?.map((cell) => cell?.char ?? ' ')
      .join('')
      .trimEnd()
    expect(pastedRow).toContain(`ALPHA${pastePayload}`)
  })

  test('handles streamed UTF-8 byte sequences', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    const readRow = async (rowIndex: number): Promise<string> => {
      const row = await page.evaluate((row) => {
        const handle = window.__manaTerminalTestHandle__
        if (!handle) {
          return null
        }
        const snapshot = handle.getSnapshot()
        const cells = snapshot.buffer[row] ?? []
        return cells.map((cell) => cell?.char ?? ' ').join('')
      }, rowIndex)

      expect(row).not.toBeNull()
      return row!.trimEnd()
    }

    // Reset the terminal state so assertions remain deterministic across browsers.
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001bc')
    })

    // 1. Single chunk emoji as raw bytes.
    await page.evaluate((chunk) => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        throw new Error('Terminal handle unavailable')
      }
      handle.write(new Uint8Array(chunk))
    }, [0xf0, 0x9f, 0x91, 0x8b])

    await expect.poll(() => readRow(0)).toBe('👋')

    // Move to next line for subsequent scenarios.
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\r\n')
    })

    // 2. Emoji split across two writes to verify buffering works across boundaries.
    await page.evaluate((chunks) => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        throw new Error('Terminal handle unavailable')
      }
      for (const chunk of chunks) {
        handle.write(new Uint8Array(chunk))
      }
    }, [
      [0xf0, 0x9f],
      [0x92, 0x96],
    ])

    await expect.poll(() => readRow(1)).toBe('💖')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\r\n')
    })

    // 3. Unterminated multibyte sequence followed by ASCII should yield replacement + ASCII.
    await page.evaluate((chunks) => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        throw new Error('Terminal handle unavailable')
      }
      for (const chunk of chunks) {
        handle.write(new Uint8Array(chunk))
      }
    }, [
      [0xf0],
      [0x41],
    ])

    await expect.poll(() => readRow(2)).toBe('\ufffdA')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\r\n')
    })

    // 4. Strings with multi-byte code points still flow correctly through the harness.
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('naïve café')
    })

    await expect.poll(() => readRow(3)).toBe('naïve café')
  })

  test('honours reverse video via DECSCNM', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    const readPixel = async (
      position: { x: number; y: number } = { x: 10, y: 10 },
    ): Promise<[number, number, number]> => {
      return page.evaluate(({ x, y }) => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
        if (!canvas) {
          throw new Error('Canvas element not found')
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('Canvas context not available')
        }
        const scale = window.devicePixelRatio || 1
        const data = ctx.getImageData(
          Math.floor(x * scale),
          Math.floor(y * scale),
          1,
          1,
        ).data
        return [data[0]!, data[1]!, data[2]!]
      }, position)
    }

    const before = await readPixel()
    expect(before[0]).toBeGreaterThanOrEqual(0)
    expect(before[1]).toBeGreaterThanOrEqual(0)
    expect(before[2]).toBeGreaterThanOrEqual(0)

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?5h')
    })

    await expect.poll(() =>
      page.evaluate(() =>
        window.__manaTerminalTestHandle__?.getSnapshot().reverseVideo ?? false,
      ),
    ).toBe(true)

    await page.waitForTimeout(50)
    const after = await readPixel()
    const brightnessBefore = before[0] + before[1] + before[2]
    const brightnessAfter = after[0] + after[1] + after[2]
    expect(brightnessAfter).toBeGreaterThan(brightnessBefore + 120)

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?5l')
    })

    await expect.poll(() =>
      page.evaluate(() =>
        window.__manaTerminalTestHandle__?.getSnapshot().reverseVideo ?? true,
      ),
    ).toBe(false)

    await page.waitForTimeout(50)
    const reverted = await readPixel()
    const brightnessReverted = reverted[0] + reverted[1] + reverted[2]
    expect(Math.abs(brightnessReverted - brightnessBefore)).toBeLessThanOrEqual(60)
  })

  test('renders SGR sequences with colon separators', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write(
        '\u001b[;4:3;38;2;175;175;215;58:2::190:80:70mX',
      )
    })

    const cell = await page.evaluate(() => {
      const snapshot = window.__manaTerminalTestHandle__?.getSnapshot()
      if (!snapshot) {
        return null
      }
      const first = snapshot.buffer[0]?.[0]
      if (!first) {
        return null
      }
      return {
        char: first.char,
        attr: first.attr,
      }
    })

    expect(cell).not.toBeNull()
    expect(cell?.char).toBe('X')
    expect(cell?.attr.foreground).toEqual({
      type: 'rgb',
      r: 175,
      g: 175,
      b: 215,
    })
    expect(cell?.attr.underline).not.toBe('none')
    expect(cell?.attr.italic).toBe(false)
  })

  test('locks G2 into GL and renders DEC special glyphs', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b*0\u001bnqq')
    })

    const chars = await page.evaluate(() => {
      const snapshot = window.__manaTerminalTestHandle__?.getSnapshot()
      if (!snapshot) {
        return null
      }
      return snapshot.buffer[0]?.slice(0, 2).map((cell) => cell?.char ?? '') ?? []
    })

    expect(chars).toEqual(['─', '─'])
  })

  test('responds to device attribute queries', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[>0c')
    })

    await expect.poll(() =>
      page.evaluate(() =>
        window.__manaTerminalTestHandle__
          ?.getResponses()
          .find((entry) => entry.includes('[>')) ?? null,
      ),
    ).toContain('[>62;1;2c')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?6$p')
    })

    await expect.poll(() =>
      page.evaluate(() =>
        window.__manaTerminalTestHandle__
          ?.getResponses()
          .find((entry) => entry.includes('$y')) ?? null,
      ),
    ).toContain('[?6;')
  })

  test('single click moves the cursor within line bounds', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('HELLO')
    })

    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    if (!box) {
      throw new Error('Canvas bounding box unavailable')
    }

    const snapshotBefore = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    if (!snapshotBefore) {
      throw new Error('Snapshot unavailable')
    }

    const cellWidth = box.width / snapshotBefore.columns
    const cellHeight = box.height / snapshotBefore.rows

    await canvas.click({
      position: {
        x: box.width - cellWidth / 4,
        y: cellHeight / 2,
      },
    })

    const snapshotAfter = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    expect(snapshotAfter).toBeTruthy()
    if (!snapshotAfter) {
      throw new Error('Snapshot unavailable after click')
    }

    expect(snapshotAfter.cursor.row).toBe(0)
    expect(snapshotAfter.cursor.column).toBe(5)
    expect(snapshotAfter.selection).toBeNull()
  })

  test('insert mode toggles via CSI 4 h / 4 l', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('ABCD')
    })

    const getRowChars = async (): Promise<string[]> => {
      return page.evaluate(() => {
        const snapshot = window.__manaTerminalTestHandle__?.getSnapshot()
        if (!snapshot) {
          return []
        }
        return (snapshot.buffer[0] ?? []).map((cell) => cell?.char ?? ' ')
      })
    }

    await expect.poll(async () => (await getRowChars()).join('').trimEnd()).toBe(
      'ABCD',
    )

    // Move cursor two columns left (ESC [ 2 D)
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[2D')
    })

    // Type X in replace mode (default IRM off)
    await page.keyboard.type('X')
    await expect.poll(async () => (await getRowChars()).join('').trimEnd()).toBe(
      'ABXD',
    )

    // Enable insert mode and type Y
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[4h')
    })
    await page.keyboard.type('Y')
    await expect.poll(async () => (await getRowChars()).slice(0, 6)).toEqual([
      'A',
      'B',
      'X',
      'Y',
      ' ',
      ' ',
    ])

    // Disable insert mode and type Z (should overwrite)
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[4l')
    })
    await page.keyboard.type('Z')
    await expect.poll(async () => (await getRowChars()).slice(0, 5)).toEqual([
      'A',
      'B',
      'X',
      'Y',
      'Z',
    ])

    expect((await getRowChars()).join('').trimEnd()).toBe('ABXYZ')
  })
})
