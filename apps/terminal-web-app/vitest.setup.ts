import '@testing-library/jest-dom/vitest'
import { createElement, forwardRef, useImperativeHandle } from 'react'
import { vi } from 'vitest'

vi.mock('@mana/tui-react', () => {
  const focus = vi.fn()
  const write = vi.fn()
  const reset = vi.fn()
  const getSnapshot = vi.fn(() => ({ buffer: [] }))

  ;(globalThis as any).__manaTerminalMock__ = { focus, write, reset, getSnapshot }

  const Terminal = forwardRef((_props: any, ref) => {
    useImperativeHandle(ref, () => ({
      focus,
      write,
      reset,
      getSnapshot,
    }))

    return createElement(
      'div',
      {
        role: 'textbox',
        tabIndex: 0,
        'data-testid': 'terminal-stub',
      },
      createElement('canvas', { 'data-testid': 'terminal-canvas' }),
    )
  })

  return { Terminal }
})
