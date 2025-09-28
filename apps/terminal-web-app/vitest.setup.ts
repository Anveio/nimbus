import '@testing-library/jest-dom/vitest'
import { createElement, forwardRef, useImperativeHandle } from 'react'
import { vi } from 'vitest'

vi.mock('@mana-ssh/tui-react', () => {
  const Terminal = forwardRef((_props: any, ref) => {
    useImperativeHandle(ref, () => ({
      focus: vi.fn(),
      write: vi.fn(),
      reset: vi.fn(),
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
