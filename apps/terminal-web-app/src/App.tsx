import { useEffect, useRef, type JSX } from 'react'
import { Terminal, type TerminalHandle } from '@mana-ssh/tui-react'
import styles from './App.module.css'

const WELCOME_BANNER = `Mana SSH terminal ready.\r\nType into the canvas to interact.\r\n\r\n`

function App(): JSX.Element {
  const terminalRef = useRef<TerminalHandle>(null)

  useEffect(() => {
    terminalRef.current?.focus()
    terminalRef.current?.write(WELCOME_BANNER)
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
