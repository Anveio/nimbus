import { test, expect } from '@playwright/test'
import type { TerminalHandle } from '@mana-ssh/tui-react'
import { getSelectionRowSegments, type TerminalSelection, type TerminalState } from '@mana-ssh/vt'
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
    for (let column = segment.startColumn; column <= segment.endColumn; column += 1) {
      currentLine += rowCells[column]?.char ?? ' '
    }
  }

  flush()
  return lines.join('\n')
}

test.describe('terminal e2e harness', () => {
  test('renders the welcome banner via injected bytes', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.click()

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

  test('supports keyboard selection and clipboard copy/paste', async ({ page }) => {
    const copyShortcut = process.platform === 'darwin' ? 'Meta+C' : 'Control+Shift+C'
    const pasteShortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V'

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

    const selectionAfterKeys = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSelection(),
    )
    console.log('selectionAfterKeys', selectionAfterKeys)

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
    const clipboardText = await page.evaluate(async () => navigator.clipboard.readText())
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
})
