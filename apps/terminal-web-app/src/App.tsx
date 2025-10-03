import type { TerminalGraphicsOptions } from '@mana/tui-react'
import { Terminal, type TerminalHandle } from '@mana/tui-react'
import { type JSX, useEffect, useRef, useState } from 'react'
import styles from './App.module.css'

const isE2EMode = import.meta.env?.VITE_E2E === '1'

declare global {
  interface Window {
    __manaTerminalTestHandle__?: {
      write: (input: Uint8Array | string) => void
      getSnapshot: () => ReturnType<TerminalHandle['getSnapshot']>
      getSelection: () => ReturnType<TerminalHandle['getSelection']>
      getResponses: () => ReadonlyArray<Uint8Array>
      getPrinterEvents: () => ReturnType<TerminalHandle['getPrinterEvents']>
      getDiagnostics: () => ReturnType<TerminalHandle['getDiagnostics']>
      getRendererBackend: () => string | null
    }
  }
}

function App(): JSX.Element {
  const terminalRef = useRef<TerminalHandle>(null)
  const responsesRef = useRef<Uint8Array[]>([])
  const diagnosticsRef =
    useRef<ReturnType<TerminalHandle['getDiagnostics']>>(null)
  const [graphicsOptions] = useState<TerminalGraphicsOptions | undefined>(
    () => {
      if (typeof window === 'undefined') {
        return undefined
      }
      const params = new URLSearchParams(window.location.search)
      const rendererParam = params.get('renderer')?.toLowerCase()
      switch (rendererParam) {
        case 'webgl':
          return { type: 'webgl' as const }
        case 'cpu':
          return { type: 'canvas-cpu' as const }
        default:
          return undefined
      }
    },
  )

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
        write: (input: Uint8Array | string) => {
          resolveHandle().write(input)
        },
        getSnapshot: () => resolveHandle().getSnapshot(),
        getSelection: () => resolveHandle().getSelection(),
        getResponses: () => responsesRef.current.map((entry) => entry.slice()),
        getPrinterEvents: () => resolveHandle().getPrinterEvents(),
        getDiagnostics: () => diagnosticsRef.current,
        getRendererBackend: () => resolveHandle().getRendererBackend() ?? null,
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
      <h1 className={styles.heading}>Mana Web Terminal</h1>
      <div className={styles.terminalWrapper}>
        <Terminal
          ref={terminalRef}
          className={styles.terminalSurface}
          accessibility={{ ariaLabel: 'Interactive terminal' }}
          graphics={graphicsOptions}
          instrumentation={{
            onData: (data) => {
              responsesRef.current.push(data.slice())
            },
            onDiagnostics: (diagnostics) => {
              diagnosticsRef.current = diagnostics
            },
          }}
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
