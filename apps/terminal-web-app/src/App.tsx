import { Terminal, type TerminalHandle } from '@mana-ssh/tui-react'
import { type JSX, useEffect, useRef } from 'react'
import styles from './App.module.css'

const WELCOME_BANNER =
  `\u001b[38;2;88;166;255m┏━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━┓\r\n` +
  `\u001b[38;2;88;166;255m┃\u001b[0m  \u001b[1;38;2;35;134;54mMana SSH Web Terminal\u001b[0m  \u001b[38;2;88;166;255m┃\r\n` +
  `\u001b[38;2;88;166;255m┣━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━┫\r\n` +
  `\u001b[0m  🛰  \u001b[3mConnected to virtual constellation\u001b[0m\r\n` +
  `  🧪  \u001b[38;2;255;215;0mExperimental session — type freely!\u001b[0m\r\n` +
  `  🌈  \u001b[38;2;180;82;205mANSI colors,\u001b[38;2;97;218;251m truecolor,\u001b[38;2;130;170;255m emoji ✨\u001b[0m\r\n` +
  `  🔁  \u001b[4mEcho is local until you wire a host\u001b[0m\r\n` +
  `  ⌨️  Paste, arrow keys, and Ctrl shortcuts supported\r\n` +
  `\u001b[38;2;88;166;255m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\u001b[0m\r\n\r\n`

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
