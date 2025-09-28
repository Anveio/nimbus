import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import App from '../src/App'

describe('App', () => {
  test('renders terminal demo scaffold', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /mana ssh web terminal/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('terminal-canvas')).toBeInTheDocument()
    expect(screen.getByText(/echoes everything locally/i)).toBeInTheDocument()
  })
})
