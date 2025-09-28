import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('@mana-ssh/tui-web-canvas-renderer', () => {
  const createCanvasRenderer = vi.fn((options: { canvas: HTMLCanvasElement }) => {
    const instance = {
      canvas: options.canvas,
      applyUpdates: vi.fn(),
      resize: vi.fn(),
      setTheme: vi.fn(),
      sync: vi.fn(),
      dispose: vi.fn(),
      diagnostics: {
        lastFrameDurationMs: null,
        lastDrawCallCount: null,
        lastOsc: null,
        lastSosPmApc: null,
        lastDcs: null,
      },
    }
    return instance
  })

  return {
    createCanvasRenderer,
  }
})
