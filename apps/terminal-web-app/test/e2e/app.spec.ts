import type { TerminalHandle } from '@mana-ssh/tui-react'
import {
  getSelectionRowSegments,
  type TerminalSelection,
  type TerminalState,
} from '@mana-ssh/vt'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { WELCOME_BANNER } from './fixtures/welcomeBanner'

// Scenario structure follows the guidance in docs/e2e-test-harness.md (Global harness handle)

declare global {
  interface Window {
    __manaTerminalTestHandle__?: {
      write: (input: string | Uint8Array) => void
      getSnapshot: () => ReturnType<TerminalHandle['getSnapshot']>
      getSelection: () => ReturnType<TerminalHandle['getSelection']>
      getResponses: () => ReadonlyArray<Uint8Array>
      getDiagnostics: () => ReturnType<TerminalHandle['getDiagnostics']>
      getPrinterEvents: () => ReturnType<TerminalHandle['getPrinterEvents']>
      getRendererBackend: () => string | null
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: Required
const STRIP_ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

const SNAPSHOT_PATTERN = /\s+$/u

const stripAnsi = (value: string): string =>
  value.replace(STRIP_ANSI_PATTERN, '')

const snapshotToPlainText = (snapshot: TerminalState): string => {
  const lines = snapshot.buffer.map((row) => {
    const cells = row ?? []
    const text = cells.map((cell) => cell?.char ?? ' ').join('')
    return text.replace(SNAPSHOT_PATTERN, '')
  })
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.join('\n')
}

const canInitialiseWebgl = async (page: Page): Promise<boolean> => {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })
    if (!gl) {
      return false
    }
    const shader = gl.createShader(gl.VERTEX_SHADER)
    if (!shader) {
      return false
    }
    gl.shaderSource(
      shader,
      `#version 300 es\nprecision mediump float;\nprecision mediump int;\nlayout(location = 0) in vec2 a_position;\nvoid main() {\n  gl_Position = vec4(a_position, 0.0, 1.0);\n}`,
    )
    gl.compileShader(shader)
    const status = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
    gl.deleteShader(shader)
    return Boolean(status)
  })
}

const getResponseCodesFrom = async (
  page: Page,
  offset: number,
): Promise<number[][]> => {
  return page.evaluate((start) => {
    const handle = window.__manaTerminalTestHandle__
    if (!handle) {
      return []
    }
    const responses = handle.getResponses()
    return responses.slice(start).map((entry) => Array.from(entry))
  }, offset)
}

const normaliseDeviceAttributes = (codes: number[]): string => {
  if (codes.length === 0) {
    return ''
  }
  if (codes[0] === 0x9b) {
    return String.fromCharCode(...codes.slice(1))
  }
  if (codes[0] === 0x1b && codes[1] === 0x5b) {
    return String.fromCharCode(...codes.slice(2))
  }
  return String.fromCharCode(...codes)
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

  test('renders the welcome banner with the WebGL renderer', async ({
    page,
  }) => {
    test.fixme(
      true,
      'WebGL backend blocked in headless Chromium; tracked for follow-up',
    )
    test.setTimeout(6_000)
    await page.goto('/?renderer=webgl')

    const supportsWebgl = await canInitialiseWebgl(page)
    if (!supportsWebgl) {
      test.skip()
      return
    }

    const terminal = page.getByRole('textbox', {
      name: 'Interactive terminal',
    })
    await expect(terminal).toBeVisible()
    await terminal.focus()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()

    await page.evaluate((banner) => {
      window.__manaTerminalTestHandle__?.write(banner)
    }, WELCOME_BANNER)

    await page.waitForTimeout(50)

    const backendAttribute = await canvas.getAttribute(
      'data-mana-renderer-backend',
    )
    if (backendAttribute !== 'gpu-webgl') {
      test.skip()
      return
    }

    const snapshot = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    expect(snapshot).toBeTruthy()
    if (!snapshot) {
      throw new Error('Snapshot unavailable for WebGL renderer test')
    }

    const snapshotText = snapshotToPlainText(snapshot)
    const expectedText = stripAnsi(WELCOME_BANNER)
      .replace(/\r/g, '')
      .replace(/\n+$/g, '')
    expect(snapshotText).toContain('Mana SSH Web Terminal')
    expect(snapshotText).toBe(expectedText)
  })

  test('supports keyboard selection and clipboard copy/paste', async ({
    page,
  }) => {
    test.setTimeout(6_000)
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

  test('raw DEL remains inert while DOM backspace deletes locally', async ({
    page,
  }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    await page.evaluate(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return
      }
      handle.write('\u001b[2J\u001b[H')
      handle.write('foo')
      handle.write(new Uint8Array([0x7f]))
    })

    await page.waitForFunction(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return false
      }
      const snapshot = handle.getSnapshot()
      const row = snapshot.buffer[0]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      return row === 'foo'
    })

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[2J\u001b[H')
    })

    await page.keyboard.type('TEST')
    const responseOffset = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.keyboard.press('Backspace')

    await page.waitForFunction(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return false
      }
      const snapshot = handle.getSnapshot()
      const row = snapshot.buffer[0]
        ?.map((cell) => cell?.char ?? ' ')
        .join('')
        .trimEnd()
      return row === 'TES'
    })

    const responses = await getResponseCodesFrom(page, responseOffset)
    expect(responses).toHaveLength(1)
    expect(responses[0]).toEqual([0x7f])
  })

  test('honours legacy ESC 1/2 double-height aliases', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await expect(terminal).toBeVisible()
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    await page.evaluate(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return
      }
      handle.write('\u001b1')
    })

    await page.waitForFunction(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return false
      }
      return handle.getSnapshot().lineAttributes[0] === 'double-top'
    })

    await page.evaluate(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return
      }
      handle.write('\n\u001b2')
    })

    await page.waitForFunction(() => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return false
      }
      return handle.getSnapshot().lineAttributes[1] === 'double-bottom'
    })
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
    await page.evaluate(
      (chunk) => {
        const handle = window.__manaTerminalTestHandle__
        if (!handle) {
          throw new Error('Terminal handle unavailable')
        }
        handle.write(new Uint8Array(chunk))
      },
      [0xf0, 0x9f, 0x91, 0x8b],
    )

    await expect.poll(() => readRow(0)).toBe('👋')

    // Move to next line for subsequent scenarios.
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\r\n')
    })

    // 2. Emoji split across two writes to verify buffering works across boundaries.
    await page.evaluate(
      (chunks) => {
        const handle = window.__manaTerminalTestHandle__
        if (!handle) {
          throw new Error('Terminal handle unavailable')
        }
        for (const chunk of chunks) {
          handle.write(new Uint8Array(chunk))
        }
      },
      [
        [0xf0, 0x9f],
        [0x92, 0x96],
      ],
    )

    await expect.poll(() => readRow(1)).toBe('💖')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\r\n')
    })

    // 3. Unterminated multibyte sequence followed by ASCII should yield replacement + ASCII.
    await page.evaluate(
      (chunks) => {
        const handle = window.__manaTerminalTestHandle__
        if (!handle) {
          throw new Error('Terminal handle unavailable')
        }
        for (const chunk of chunks) {
          handle.write(new Uint8Array(chunk))
        }
      },
      [[0xf0], [0x41]],
    )

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
        const canvas = document.querySelector(
          'canvas',
        ) as HTMLCanvasElement | null
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

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__manaTerminalTestHandle__?.getSnapshot().reverseVideo ??
            false,
        ),
      )
      .toBe(true)

    await page.waitForTimeout(50)
    const after = await readPixel()
    const brightnessBefore = before[0] + before[1] + before[2]
    const brightnessAfter = after[0] + after[1] + after[2]
    expect(brightnessAfter).toBeGreaterThan(brightnessBefore + 120)

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?5l')
    })

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__manaTerminalTestHandle__?.getSnapshot().reverseVideo ??
            true,
        ),
      )
      .toBe(false)

    await page.waitForTimeout(50)
    const reverted = await readPixel()
    const brightnessReverted = reverted[0] + reverted[1] + reverted[2]
    expect(Math.abs(brightnessReverted - brightnessBefore)).toBeLessThanOrEqual(
      60,
    )
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
      return (
        snapshot.buffer[0]?.slice(0, 2).map((cell) => cell?.char ?? '') ?? []
      )
    })

    expect(chars).toEqual(['─', '─'])
  })

  test('responds to device attribute queries', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))
    const initialCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[c')
    })

    const primaryResponses = await getResponseCodesFrom(page, initialCount)
    const primaryDeviceAttributes = primaryResponses.pop() ?? []
    expect(primaryDeviceAttributes[0]).toBe(0x9b)
    expect(normaliseDeviceAttributes(primaryDeviceAttributes)).toBe(
      '?62;1;2;6;7;8;9c',
    )

    const afterPrimaryCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[>0c')
    })

    const secondaryResponses = await getResponseCodesFrom(
      page,
      afterPrimaryCount,
    )
    const secondaryDeviceAttributes = secondaryResponses.pop() ?? []
    expect(secondaryDeviceAttributes[0]).toBe(0x9b)
    expect(normaliseDeviceAttributes(secondaryDeviceAttributes)).toBe(
      '>62;1;2c',
    )

    const afterSecondaryCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?6$p')
    })

    await expect
      .poll(async () => {
        const codes = await getResponseCodesFrom(page, afterSecondaryCount)
        const match = codes.find((entry) =>
          normaliseDeviceAttributes(entry).includes('?6;'),
        )
        return match ? normaliseDeviceAttributes(match) : null
      })
      .toContain('?6;')

    const afterStatusCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[5n')
    })

    await expect
      .poll(async () => {
        const codes = await getResponseCodesFrom(page, afterStatusCount)
        const match = codes.find(
          (entry) => normaliseDeviceAttributes(entry) === '0n',
        )
        return match ? normaliseDeviceAttributes(match) : null
      })
      .toBe('0n')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[10;20H')
    })

    const afterCprCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[6n')
    })

    await expect
      .poll(async () => {
        const codes = await getResponseCodesFrom(page, afterCprCount)
        const match = codes.find(
          (entry) => normaliseDeviceAttributes(entry) === '10;20R',
        )
        return match ? normaliseDeviceAttributes(match) : null
      })
      .toBe('10;20R')

    const afterDecidCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001bZ')
    })

    await expect
      .poll(async () => {
        const codes = await getResponseCodesFrom(page, afterDecidCount)
        const match = codes.find(
          (entry) =>
            entry.length === 3 && entry[0] === 0x1b && entry[1] === 0x2f,
        )
        return match ? match : null
      })
      .toEqual([0x1b, 0x2f, 0x5a])

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write(
        '\u001bP$qE2E-ANSWERBACK\u001b\\',
      )
    })

    const afterEnqCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u0005')
    })

    await expect
      .poll(async () => {
        const codes = await getResponseCodesFrom(page, afterEnqCount)
        const match = codes.find(
          (entry) => String.fromCharCode(...entry) === 'E2E-ANSWERBACK',
        )
        return match ? String.fromCharCode(...match) : null
      })
      .toBe('E2E-ANSWERBACK')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?4i')
      window.__manaTerminalTestHandle__?.write('\u001b[?5i')
      window.__manaTerminalTestHandle__?.write('PRINTER-DATA')
      window.__manaTerminalTestHandle__?.write('\u001b[0i')
      window.__manaTerminalTestHandle__?.write('\u001b[4i')
    })

    const printerEvents = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getPrinterEvents(),
    )

    expect(printerEvents).toBeTruthy()
    expect(
      printerEvents?.some(
        (event) => event.type === 'controller-mode' && event.enabled === true,
      ),
    ).toBe(true)
    expect(
      printerEvents?.some(
        (event) => event.type === 'auto-print-mode' && event.enabled === true,
      ),
    ).toBe(true)
    expect(
      printerEvents?.some((event) => {
        if (event.type !== 'write' || !Array.isArray(event.data)) {
          return false
        }
        return String.fromCharCode(...event.data) === 'PRINTER-DATA'
      }),
    ).toBe(true)
    expect(printerEvents?.some((event) => event.type === 'print-screen')).toBe(
      true,
    )
  })

  test('switches C1 transmission using S7C1T', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    const initialCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[c')
    })

    const initialResponses = await getResponseCodesFrom(page, initialCount)
    const initialDeviceAttributes = initialResponses.pop() ?? []
    expect(initialDeviceAttributes[0]).toBe(0x9b)

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__manaTerminalTestHandle__?.getSnapshot().c1Transmission,
        ),
      )
      .toBe('8-bit')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?66h')
    })

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__manaTerminalTestHandle__?.getSnapshot().c1Transmission,
        ),
      )
      .toBe('7-bit')

    const afterToggleCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[c')
    })

    const responsesAfterToggle = await getResponseCodesFrom(
      page,
      afterToggleCount,
    )
    const sevenBitResponse = responsesAfterToggle.pop() ?? []
    expect(sevenBitResponse.slice(0, 2)).toEqual([0x1b, 0x5b])

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[?66l')
    })

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__manaTerminalTestHandle__?.getSnapshot().c1Transmission,
        ),
      )
      .toBe('8-bit')

    const afterRestoreCount = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getResponses().length ?? 0,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[c')
    })

    const responsesAfterRestore = await getResponseCodesFrom(
      page,
      afterRestoreCount,
    )
    const eightBitResponse = responsesAfterRestore.pop() ?? []
    expect(eightBitResponse[0]).toBe(0x9b)
  })

  test('renders NRCS glyphs after designation', async ({ page }) => {
    await page.goto('/')

    const terminal = page.getByRole('textbox', { name: 'Interactive terminal' })
    await terminal.click()

    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    const readFirstChar = async (): Promise<string> => {
      return page.evaluate(() => {
        const snapshot = window.__manaTerminalTestHandle__?.getSnapshot()
        if (!snapshot) {
          return ''
        }
        return snapshot.buffer[0]?.[0]?.char ?? ''
      })
    }

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b(A#')
    })

    await expect.poll(readFirstChar).toBe('£')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001bc')
    })

    await expect.poll(readFirstChar).toBe(' ')

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b(K[')
    })

    await expect.poll(readFirstChar).toBe('Ä')
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

    await expect
      .poll(async () => (await getRowChars()).join('').trimEnd())
      .toBe('ABCD')

    // Move cursor two columns left (ESC [ 2 D)
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[2D')
    })

    // Type X in replace mode (default IRM off)
    await page.keyboard.type('X')
    await expect
      .poll(async () => (await getRowChars()).join('').trimEnd())
      .toBe('ABXD')

    // Enable insert mode and type Y
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[4h')
    })
    await page.keyboard.type('Y')
    await expect
      .poll(async () => (await getRowChars()).slice(0, 6))
      .toEqual(['A', 'B', 'X', 'Y', ' ', ' '])

    // Disable insert mode and type Z (should overwrite)
    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('\u001b[4l')
    })
    await page.keyboard.type('Z')
    await expect
      .poll(async () => (await getRowChars()).slice(0, 5))
      .toEqual(['A', 'B', 'X', 'Y', 'Z'])

    expect((await getRowChars()).join('').trimEnd()).toBe('ABXYZ')
  })
})

test.describe('webgl dirty rendering', () => {
  test('scroll uploads only the newly exposed row', async ({ page }) => {
    test.setTimeout(6_000)
    const supportsWebgl = await canInitialiseWebgl(page)
    test.skip(!supportsWebgl, 'WebGL not supported in this environment')

    await page.goto('/?renderer=webgl')
    await page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))

    const backend = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getRendererBackend() ?? null,
    )
    test.skip(
      backend !== 'gpu-webgl',
      `GPU backend not active (${backend ?? 'none'})`,
    )

    const snapshot = await page.evaluate(() =>
      window.__manaTerminalTestHandle__?.getSnapshot(),
    )
    expect(snapshot).toBeTruthy()
    const rows = snapshot!.rows
    const columns = snapshot!.columns
    expect(rows).toBeGreaterThan(1)
    expect(columns).toBeGreaterThan(0)

    await page.evaluate((count) => {
      const handle = window.__manaTerminalTestHandle__
      if (!handle) {
        return
      }
      for (let index = 0; index < count; index += 1) {
        handle.write(`row-${index}\n`)
      }
    }, rows - 1)

    const before = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getDiagnostics() ?? null,
    )

    await page.evaluate(() => {
      window.__manaTerminalTestHandle__?.write('final-line\n')
    })

    await page.waitForTimeout(50)

    const after = await page.evaluate(
      () => window.__manaTerminalTestHandle__?.getDiagnostics() ?? null,
    )

    if (!after || after.gpuCellsProcessed == null) {
      test.skip(true, 'GPU diagnostics unavailable')
      return
    }

    expect(after.gpuCellsProcessed).toBe(columns)
    if (after.gpuDirtyRegionCoverage !== null) {
      expect(after.gpuDirtyRegionCoverage).toBeCloseTo(1 / rows, 5)
    }
    if (
      before?.gpuBytesUploaded !== null &&
      after.gpuBytesUploaded !== null &&
      before?.gpuBytesUploaded !== undefined
    ) {
      expect(after.gpuBytesUploaded).toBeLessThan(before.gpuBytesUploaded + 1)
    }
  })
})
