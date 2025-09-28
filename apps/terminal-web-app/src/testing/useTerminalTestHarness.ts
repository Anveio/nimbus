import { useEffect, type RefObject } from 'react'
import type { TerminalHandle } from '@mana-ssh/tui-react'

export interface TerminalTestHarness {
  readonly focus: () => void
  readonly injectAnsi: (input: string) => Promise<void>
  readonly injectBytes: (input: Uint8Array) => Promise<void>
  readonly reset: () => Promise<void>
  readonly awaitIdle: () => Promise<void>
  readonly getSnapshot: () => ReturnType<TerminalHandle['getSnapshot']>
  readonly getSelection: () => ReturnType<TerminalHandle['getSelection']>
  readonly dispose: () => void
}

declare global {
  interface Window {
    __manaTest__?: TerminalTestHarness
  }
}

const isE2EMode = import.meta.env.VITE_E2E === '1'

const createTerminalTestHarness = (
  terminal: TerminalHandle,
): TerminalTestHarness => {
  const waitForNextFrame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })

  const injectBytes = async (input: Uint8Array) => {
    terminal.write(input)
    await waitForNextFrame()
  }

  const injectAnsi = async (input: string) => {
    terminal.write(input)
    await waitForNextFrame()
  }

  const reset = async () => {
    terminal.reset()
    await waitForNextFrame()
  }

  const awaitIdle = waitForNextFrame

  return {
    focus: () => {
      terminal.focus()
    },
    injectAnsi,
    injectBytes,
    reset,
    awaitIdle,
    getSnapshot: () => terminal.getSnapshot(),
    getSelection: () => terminal.getSelection(),
    dispose: () => {
      // Currently no resources to release, but keep hook for future wiring.
    },
  }
}

export const useTerminalTestHarness = (
  terminalRef: RefObject<TerminalHandle>,
): void => {
  useEffect(() => {
    if (!isE2EMode) {
      return
    }

    let rafId: number | null = null
    let disposed = false
    let harness: TerminalTestHarness | null = null

    const attachHarness = () => {
      if (disposed) {
        return
      }

      const terminal = terminalRef.current
      if (!terminal) {
        rafId = requestAnimationFrame(attachHarness)
        return
      }

      harness = createTerminalTestHarness(terminal)
      window.__manaTest__ = harness
    }

    rafId = requestAnimationFrame(attachHarness)

    return () => {
      disposed = true
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      if (harness) {
        if (window.__manaTest__ === harness) {
          delete window.__manaTest__
        }
        harness.dispose()
      }
    }
  }, [terminalRef])
}
