import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Terminal, type TerminalHandle } from '../src/Terminal'
import { createCanvasRenderer } from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalUpdate } from '@mana-ssh/vt'

const encoder = new TextEncoder()

const lastRenderer = () =>
  (createCanvasRenderer as unknown as Mock).mock.results.at(-1)!
    .value as CanvasRendererMock

type CanvasRendererMock = ReturnType<typeof createCanvasRenderer> & {
  applyUpdates: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  setTheme: ReturnType<typeof vi.fn>
  sync: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

describe('Terminal', () => {
  test('renders focusable terminal container with canvas', async () => {
    render(<Terminal ariaLabel="Demo terminal" />)

    const region = screen.getByRole('textbox', { name: 'Demo terminal' })
    expect(region).toHaveAttribute('tabindex', '0')

    const canvas = region.querySelector('canvas')
    expect(canvas).not.toBeNull()

    await userEvent.click(region)
    expect(region).toHaveFocus()
  })

  test('forwards key input via onData and echoes locally by default', async () => {
    const onData = vi.fn()
    render(<Terminal onData={onData} />)

    const region = screen.getByRole('textbox')
    await userEvent.click(region)
    await userEvent.keyboard('a')

    expect(onData).toHaveBeenCalledWith(encoder.encode('a'))
    const renderer = lastRenderer()
    expect(renderer.applyUpdates).toHaveBeenCalled()
  })

  test('supports imperative write and reset APIs', async () => {
    const ref = createRef<TerminalHandle>()

    render(<Terminal ref={ref} />)

    expect(ref.current).not.toBeNull()

    await act(async () => {
      ref.current!.write('hello')
    })

    const renderer = lastRenderer()
    expect(renderer.applyUpdates).toHaveBeenCalled()

    await act(async () => {
      ref.current!.reset()
    })

    expect(renderer.sync).toHaveBeenCalled()
  })

  test('disables local echo when requested', async () => {
    const onData = vi.fn()
    render(<Terminal onData={onData} localEcho={false} />)
    const region = screen.getByRole('textbox')

    const renderer = lastRenderer()
    const initialCalls = renderer.applyUpdates.mock.calls.length

    await userEvent.click(region)
    await userEvent.keyboard('z')

    expect(onData).toHaveBeenCalled()
    expect(renderer.applyUpdates.mock.calls.length).toBe(initialCalls)
  })

  test('falls back to local newline when no onData handler is provided', async () => {
    render(<Terminal />)
    const region = screen.getByRole('textbox')
    const renderer = lastRenderer()

    await userEvent.click(region)
    await userEvent.keyboard('A')

    renderer.applyUpdates.mockClear()

    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('B')

    const updates = renderer.applyUpdates.mock.calls.flatMap(
      ([options]) => options.updates as ReadonlyArray<TerminalUpdate>,
    )

    const cell = updates
      .filter(
        (update): update is Extract<TerminalUpdate, { type: 'cells' }> =>
          update.type === 'cells',
      )
      .flatMap((update) => update.cells)
      .find((entry) => entry.cell.char === 'B')

    expect(cell).toBeDefined()
    expect(cell?.row).toBe(1)
    expect(cell?.column).toBe(0)
  })
})
