import { useEffect, useMemo, useRef } from 'react'
import type { JSX } from 'react'
import { Terminal } from '..'
import type { TerminalSessionHandle } from '..'
import './styles.css'

declare global {
  interface Window {
    __manaTuiReactTestHandle__?: TerminalSessionHandle
  }
}

export function App(): JSX.Element {
  const terminalRef = useRef<TerminalSessionHandle>(null)

  useEffect(() => {
    let frame: number | null = null
    const attach = () => {
      const handle = terminalRef.current
      if (!handle) {
        frame = requestAnimationFrame(attach)
        return
      }
      window.__manaTuiReactTestHandle__ = handle
    }

    attach()
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
      if (window.__manaTuiReactTestHandle__) {
        delete window.__manaTuiReactTestHandle__
      }
    }
  }, [])

  const containerProps = useMemo(
    () => ({
      className: 'app-terminal-container',
    }),
    [],
  )

  const renderRootProps = useMemo(
    () => ({
      className: 'app-terminal-canvas',
      'data-testid': 'tui-react-canvas',
    }),
    [],
  )

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">Nimbus TUI React Harness</h1>
        <p className="app-subtitle">
          The demo mounts the public <code className="app-code">&lt;Terminal /&gt;</code> component using the layered renderer stack.
        </p>
      </header>
      <section className="app-terminal">
        <Terminal
          ref={terminalRef}
          renderRootProps={renderRootProps}
        />
      </section>
    </main>
  )
}

export default App
