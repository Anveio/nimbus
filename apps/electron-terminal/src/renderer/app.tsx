import {
  Terminal,
  type TerminalHandle,
  type TerminalInstrumentationOptions,
} from '@mana/tui-react'
import type { CSSProperties, JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SessionDiagnostic,
  SessionOpenOptions,
  SessionStatus,
} from '../shared/session-types'

const MAX_DIAGNOSTICS = 32

const STATUS_LABELS: Record<SessionStatus['type'], string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  ready: 'Ready',
  closed: 'Closed',
  error: 'Error',
}

interface RendererDiagnostic {
  readonly source: 'renderer' | 'session'
  readonly level: SessionDiagnostic['level']
  readonly message: string
}

export function ElectronTerminalApp(): JSX.Element {
  const [status, setStatus] = useState<SessionStatus>({ type: 'idle' })
  const [diagnostics, setDiagnostics] = useState<RendererDiagnostic[]>([])
  const [version] = useState<string>(() => window.mana?.version ?? '0.0.0')
  const [sessionDefaults] = useState<SessionOpenOptions | null>(
    () => window.mana?.session.getDefaultOptions() ?? null,
  )
  const [sessionError, setSessionError] = useState<string | null>(null)

  const sessionRef = useRef(window.mana?.session ?? null)
  const terminalRef = useRef<TerminalHandle | null>(null)

  const appendDiagnostic = useCallback((entry: RendererDiagnostic) => {
    setDiagnostics((current) => {
      const next = [...current, entry]
      if (next.length > MAX_DIAGNOSTICS) {
        next.splice(0, next.length - MAX_DIAGNOSTICS)
      }
      return next
    })
  }, [])

  useEffect(() => {
    const session = sessionRef.current
    if (!session) {
      setSessionError('Mana session bridge unavailable in preload context.')
      return
    }

    const disposers: Array<() => void> = []

    disposers.push(
      session.onData((payload) => {
        terminalRef.current?.write(payload)
      }),
    )

    disposers.push(
      session.onStatus((nextStatus) => {
        setStatus(nextStatus)
        if (nextStatus.type === 'error') {
          setSessionError(nextStatus.message)
        }
      }),
    )

    disposers.push(
      session.onDiagnostic((entry) => {
        appendDiagnostic({
          source: 'session',
          level: entry.level,
          message: `${entry.code}: ${entry.message}`,
        })
      }),
    )

    ;(async () => {
      try {
        await session.open(sessionDefaults ?? undefined)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to open session'
        setSessionError(message)
        appendDiagnostic({
          source: 'session',
          level: 'error',
          message,
        })
      }
    })()

    return () => {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose?.()
        } catch {
          /* noop */
        }
      }
      void session.close()
    }
  }, [appendDiagnostic, sessionDefaults])

  const handleTerminalReady = useCallback((handle: TerminalHandle) => {
    terminalRef.current = handle
    const session = sessionRef.current
    const snapshot = handle.getSnapshot()
    if (session && snapshot) {
      session.resize({ columns: snapshot.columns, rows: snapshot.rows })
    }
  }, [])

  const instrumentation = useMemo<
    TerminalInstrumentationOptions | undefined
  >(() => {
    const session = sessionRef.current
    if (!session) {
      return undefined
    }
    return {
      onData: (payload) => {
        try {
          session.send(payload)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to forward input'
          appendDiagnostic({
            source: 'renderer',
            level: 'error',
            message,
          })
        }
      },
      onDiagnostics: (rendererDiagnostics) => {
        if (!rendererDiagnostics) {
          return
        }
        appendDiagnostic({
          source: 'renderer',
          level: 'info',
          message: 'canvas diagnostics updated',
        })
      },
      onFrame: (event) => {
        if (event.reason === 'resize' || event.reason === 'initial-sync') {
          const snapshot = terminalRef.current?.getSnapshot()
          if (snapshot) {
            session.resize({
              columns: snapshot.columns,
              rows: snapshot.rows,
            })
          }
        }
        appendDiagnostic({
          source: 'renderer',
          level: 'info',
          message: `frame:${event.reason}`,
        })
      },
    }
  }, [appendDiagnostic])

  const statusLabel = STATUS_LABELS[status.type]

  return (
    <div style={styles.appShell}>
      <header style={styles.header}>
        <div>
          <strong>Mana Electron Terminal</strong>
        </div>
        <div>App version: {version}</div>
        <div>Transport: {sessionDefaults?.transport ?? 'echo'}</div>
      </header>
      <main style={styles.main}>
        <section style={styles.terminalPane}>
          <Terminal
            ref={terminalRef}
            accessibility={{ ariaLabel: 'Electron Terminal' }}
            instrumentation={instrumentation}
            styling={{ autoResize: true, localEcho: true }}
            onHandleReady={handleTerminalReady}
            data-testid="electron-terminal"
          />
        </section>
        <aside style={styles.sidebar}>
          <h2 style={styles.sidebarHeading}>Session</h2>
          <p style={styles.statusRow}>
            <strong>Status:</strong> {statusLabel}
          </p>
          {sessionError ? <p style={styles.errorText}>{sessionError}</p> : null}
          <h3 style={styles.sidebarHeading}>Diagnostics</h3>
          <ul style={styles.diagnosticList}>
            {diagnostics.map((entry, index) => (
              <li
                key={`${entry.source}-${index}`}
                style={styles.diagnosticItem}
              >
                <span style={resolveDiagnosticSourceStyle(entry.source)}>
                  {entry.source}
                </span>
                <span>{entry.level}</span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  )
}

const styles = {
  appShell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0c0c0c',
    color: '#f5f5f5',
    fontFamily: 'system-ui, sans-serif',
  } as const,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid rgba(245, 245, 245, 0.15)',
    alignItems: 'center',
  } as const,
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  } as const,
  terminalPane: {
    flex: 1,
    padding: '1rem',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  } as const,
  sidebar: {
    width: '320px',
    borderLeft: '1px solid rgba(245, 245, 245, 0.15)',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    overflowY: 'auto',
  } as const,
  sidebarHeading: {
    margin: '0 0 0.25rem 0',
    fontSize: '0.9rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'rgba(245, 245, 245, 0.75)',
  } as const,
  statusRow: {
    margin: 0,
    fontSize: '0.95rem',
  } as const,
  errorText: {
    margin: 0,
    color: '#ff6b6b',
    fontSize: '0.9rem',
  } as const,
  diagnosticList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  } as const,
  diagnosticItem: {
    display: 'grid',
    gridTemplateColumns: 'auto auto 1fr',
    gap: '0.5rem',
    fontSize: '0.8rem',
    background: 'rgba(255, 255, 255, 0.05)',
    padding: '0.5rem',
    borderRadius: '0.375rem',
  } as const,
} satisfies Record<string, unknown>

const resolveDiagnosticSourceStyle = (
  source: 'renderer' | 'session',
): CSSProperties => ({
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: source === 'renderer' ? '#8be9fd' : '#50fa7b',
})
