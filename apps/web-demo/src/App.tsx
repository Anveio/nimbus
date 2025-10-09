import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import {
  connectAndOpenSsh,
  type BrowserSshSession,
} from '@mana/websocket/client/web'
import type { ConnectionState } from '@mana/websocket/client/web'
import styles from './App.module.css'

type Status = 'idle' | 'connecting' | 'connected' | 'error'

function serialize(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function App(): JSX.Element {
  const [signedUrl, setSignedUrl] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('closed')
  const [error, setError] = useState<string | null>(null)
  const [logEntries, setLogEntries] = useState<string[]>([])
  const [publicKey, setPublicKey] = useState<{
    algorithm: string
    base64: string
  } | null>(null)

  const sessionRef = useRef<BrowserSshSession | null>(null)
  const disposersRef = useRef<Array<() => void>>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const appendLog = useCallback((entry: string) => {
    setLogEntries((previous) => [
      ...previous,
      `${new Date().toLocaleTimeString()} ${entry}`,
    ])
  }, [])

  const clearDisposers = useCallback(() => {
    for (const dispose of disposersRef.current) {
      try {
        dispose()
      } catch (error) {
        appendLog(
          `[ui] listener cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    disposersRef.current = []
  }, [appendLog])

  const cleanupSession = useCallback(
    async (reason: string) => {
      clearDisposers()
      const active = sessionRef.current
      if (!active) {
        return
      }
      sessionRef.current = null
      try {
        await active.dispose({ reason })
      } catch (error) {
        appendLog(
          `[ssh] dispose failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      if (mountedRef.current) {
        setConnectionState('closed')
      }
    },
    [appendLog, clearDisposers],
  )

  useEffect(() => {
    return () => {
      void cleanupSession('component-unmount')
    }
  }, [cleanupSession])

  const onConnect = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!signedUrl.trim()) {
        setError('Provide the websocket signed URL before connecting.')
        return
      }
      if (!host.trim()) {
        setError('Provide the SSH host before connecting.')
        return
      }
      setError(null)
      setPublicKey(null)
      setLogEntries([])
      setStatus('connecting')
      await cleanupSession('reconnecting')

      const sshUsername = username.trim()
      const parsedPort = Number.parseInt(port, 10)

      try {
        const session = await connectAndOpenSsh(
          { url: signedUrl.trim() },
          {
            target: {
              host: host.trim(),
              port: Number.isFinite(parsedPort) ? parsedPort : 22,
            },
            user: {
              username: sshUsername.length > 0 ? sshUsername : 'ec2-user',
              auth: { scheme: 'none' },
            },
            term: { cols: 120, rows: 32 },
          },
          {
            callbacks: {
              onClientPublicKeyReady(event) {
                const base64 = window.btoa(
                  String.fromCharCode(...event.publicKey),
                )
                setPublicKey({ algorithm: event.algorithm, base64 })
                appendLog(
                  `[ssh] client-public-key-ready (${event.algorithm}) — forward to AWS Instance Connect once the signed URL is available.`,
                )
              },
              onEvent(evt) {
                if (evt.type === 'warning') {
                  appendLog(`[ssh warn] ${evt.message}`)
                }
                if (evt.type === 'disconnect') {
                  appendLog(
                    `[ssh] disconnected (${evt.summary.description})`,
                  )
                  setStatus('idle')
                  void cleanupSession('ssh-disconnect')
                }
              },
              onDiagnostic(record) {
                appendLog(
                  `[ssh ${record.level}] ${record.code}: ${record.message}`,
                )
              },
            },
          },
        )

        const disposers: Array<() => void> = []
        const decoder = new TextDecoder()

        disposers.push(
          session.channel.on('data', (data) => {
            appendLog(`[stdout] ${decoder.decode(data)}`)
          }),
        )
        disposers.push(
          session.channel.on('stderr', (data) => {
            appendLog(`[stderr] ${decoder.decode(data)}`)
          }),
        )
        disposers.push(
          session.channel.on('exit', (payload) => {
            appendLog(
              `[channel] exit code=${payload.code ?? 'n/a'} signal=${
                payload.sig ?? 'n/a'
              }`,
            )
          }),
        )
        disposers.push(
          session.channel.on('error', (channelError) => {
            appendLog(
              `[channel] error: ${
                channelError instanceof Error
                  ? channelError.message
                  : serialize(channelError)
              }`,
            )
          }),
        )
        disposers.push(
          session.connection.on(
            'statechange',
            (state) => {
              setConnectionState(state)
            },
          ),
        )
        disposers.push(
          session.connection.on('diagnostic', (diag: unknown) => {
            appendLog(`[ws] diagnostic: ${serialize(diag)}`)
          }),
        )

        sessionRef.current = session
        disposersRef.current = disposers
        setConnectionState(session.connection.state)
        setStatus('connected')
        appendLog('[ui] SSH session established.')
      } catch (connectError) {
        await cleanupSession('connection-failed')
        setStatus('error')
        const reason =
          connectError instanceof Error
            ? connectError.message
            : String(connectError)
        setError(reason)
        appendLog(`[ui] connection failed: ${reason}`)
      }
    },
    [
      appendLog,
      cleanupSession,
      host,
      port,
      signedUrl,
      username,
    ],
  )

  const onDisconnect = useCallback(async () => {
    await cleanupSession('manual-disconnect')
    setStatus('idle')
    appendLog('[ui] session disposed by user.')
  }, [appendLog, cleanupSession])

  return (
    <main className={styles.container}>
      <header className={styles.statusBar}>
        <h1 className={styles.heading}>Mana Web SSH Client</h1>
        <div className={styles.statusGroup}>
          <span className={styles.statusLabel}>Status</span>
          <span
            className={`${styles.statusBadge} ${
              styles[`statusBadge_${status}`]
            }`}
          >
            {status === 'connected' ? connectionState : status}
          </span>
        </div>
      </header>

      <form className={styles.form} onSubmit={onConnect}>
        <label className={styles.field}>
          <span className={styles.label}>Signed WebSocket URL</span>
          <textarea
            className={styles.textarea}
            placeholder="Paste the AWS signed URL here"
            value={signedUrl}
            onChange={(event) => setSignedUrl(event.currentTarget.value)}
            rows={4}
            required
          />
        </label>
        <div className={styles.fieldGroup}>
          <label className={styles.field}>
            <span className={styles.label}>SSH Host</span>
            <input
              className={styles.input}
              placeholder="ec2-198-51-100-1.compute-1.amazonaws.com"
              value={host}
              onChange={(event) => setHost(event.currentTarget.value)}
              required
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Port</span>
            <input
              className={styles.input}
              value={port}
              onChange={(event) => setPort(event.currentTarget.value)}
              inputMode="numeric"
              pattern="\d*"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Username</span>
            <input
              className={styles.input}
              placeholder="ec2-user"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="submit"
            className={styles.buttonPrimary}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={onDisconnect}
            disabled={status !== 'connected'}
          >
            Disconnect
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </form>

      {publicKey && (
        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardTitle}>Client Public Key</span>
            <span className={styles.cardSubtitle}>{publicKey.algorithm}</span>
          </header>
          <code className={styles.cardCode}>{publicKey.base64}</code>
          <p className={styles.cardHint}>
            Forward this base64 value to AWS Instance Connect using your signed
            request before the SSH authentication phase continues.
          </p>
        </section>
      )}

      <section className={styles.logPanel}>
        <header className={styles.logHeader}>
          <span className={styles.cardTitle}>Session Log</span>
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => setLogEntries([])}
          >
            Clear
          </button>
        </header>
        <pre className={styles.logContent}>
          {logEntries.length > 0 ? logEntries.join('\n') : '— idle —'}
        </pre>
      </section>
    </main>
  )
}

export default App
