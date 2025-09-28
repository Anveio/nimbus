import { Terminal, type TerminalHandle } from '@mana-ssh/tui-react'
import { type JSX, useEffect, useRef } from 'react'
import styles from './App.module.css'
import { useTerminalTestHarness } from './testing/useTerminalTestHarness'

function App(): JSX.Element {
  const terminalRef = useRef<TerminalHandle>(null)

  useTerminalTestHarness(terminalRef)

  useEffect(() => {
    terminalRef.current?.focus()
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
