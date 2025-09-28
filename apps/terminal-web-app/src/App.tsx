import type { TerminalHost } from '@mana-ssh/tui-react'
import { TerminalCanvas } from '@mana-ssh/tui-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'

class MockHost implements TerminalHost {
  private readonly callbacks = new Set<(data: Uint8Array) => void>()
  private disposed = false

  constructor() {
    setTimeout(() => {
      if (!this.disposed) {
        this.emitText('Mana SSH terminal ready.\r\n')
        this.emitText('Type something and see it echoed below.\r\n\r\n')
      }
    }, 100)
  }

  onData(callback: (data: Uint8Array) => void): () => void {
    this.callbacks.add(callback)
    return () => {
      this.callbacks.delete(callback)
    }
  }

  write(data: Uint8Array): void {
    if (this.disposed) {
      return
    }
    const text = new TextDecoder().decode(data)
    this.emitText(text)
  }

  resize(): void {}

  dispose(): void {
    this.disposed = true
    this.callbacks.clear()
  }

  private emitText(text: string): void {
    const encoder = new TextEncoder()
    const payload = encoder.encode(text)
    this.callbacks.forEach((cb) => cb(payload))
  }
}

function App(): JSX.Element {
  const [input, setInput] = useState('')
  const hostRef = useRef<TerminalHost | null>(null)

  const host = useMemo<TerminalHost>(() => {
    const existing = hostRef.current
    if (existing) {
      return existing
    }
    const created = new MockHost()
    hostRef.current = created
    return created
  }, [])

  useEffect(
    () => () => {
      hostRef.current?.dispose()
      hostRef.current = null
    },
    [],
  )

  const sendInput = () => {
    if (!input) {
      return
    }
    const data = new TextEncoder().encode(`${input}\r\n`)
    host.write(data)
    setInput('')
  }

  return (
    <div className={styles.container}>
      <div className={styles.terminalWrapper}>
        <TerminalCanvas
          host={host}
          className={styles.terminal}
          theme={{
            background: '#0d1117',
            foreground: '#c9d1d9',
            cursor: '#58a6ff',
            cursorText: '#0d1117',
          }}
          fontFamily="'Fira Code', Menlo, monospace"
          fontSize="14px"
          lineHeight={1.2}
        />
      </div>
      <div className={styles.inputBar}>
        <input
          className={styles.textInput}
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              sendInput()
            }
          }}
          placeholder="Type command…"
        />
        <button type="button" className={styles.sendButton} onClick={sendInput}>
          Send
        </button>
      </div>
    </div>
  )
}

export default App
