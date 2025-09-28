import { Terminal, type TerminalHandle } from '@mana-ssh/tui-react'
import { type JSX, useEffect, useRef } from 'react'
import styles from './App.module.css'

const isE2EMode = import.meta.env?.VITE_E2E === '1'

declare global {
  interface Window {
    __manaTerminalTestHandle__?: {
      write: (input: string) => void
      getSnapshot: () => ReturnType<TerminalHandle['getSnapshot']>
      getSelection: () => ReturnType<TerminalHandle['getSelection']>
    }
  }
}

function App(): JSX.Element {
  const terminalRef = useRef<TerminalHandle>(null)

  useEffect(() => {
    terminalRef.current?.focus()
  }, [])

  useEffect(() => {
    // Documented in docs/e2e-test-harness.md (Global handle)
    if (!isE2EMode) {
      return
    }

    let frame: number | null = null

    const attach = () => {
      const handle = terminalRef.current
      if (!handle) {
        frame = requestAnimationFrame(attach)
        return
      }

      const resolveHandle = () => {
        const next = terminalRef.current
        if (!next) {
          throw new Error('Terminal handle is not available')
        }
        return next
      }

      const testHandle = {
        write: (input: string) => {
          resolveHandle().write(input)
        },
        getSnapshot: () => resolveHandle().getSnapshot(),
        getSelection: () => resolveHandle().getSelection(),
      }

      window.__manaTerminalTestHandle__ = testHandle
    }

    attach()

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
      if (window.__manaTerminalTestHandle__) {
        delete window.__manaTerminalTestHandle__
      }
    }
  }, [])

  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Mana SSH Web Terminal</h1>
      <div className={styles.terminalWrapper}>
        <Terminal
          ref={terminalRef}
          className={styles.terminalSurface}
          ariaLabel="Interactive terminal"
        />
      </div>
      <p className={styles.helpText}>
        This demo echoes everything locally. Connect it to your transport by
        listening to `onData` and calling `terminal.write()`.
      </p>
    </main>
  )
}

export default App
