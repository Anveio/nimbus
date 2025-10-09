import { useCallback, useMemo, type FormEvent, type JSX } from 'react'

import styles from './App.module.css'
import { useSessionLog } from './hooks/use-session-log'
import type { SessionLogEntry } from './hooks/session-log'
import { useSshFormState } from './hooks/use-ssh-form'
import { useSshSession } from './hooks/use-ssh-session'

function formatLogEntry(entry: SessionLogEntry): string {
  return `${new Date(entry.timestamp).toLocaleTimeString()} ${entry.message}`
}

function App(): JSX.Element {
  const { state: formState, updateField } = useSshFormState()
  const { entries, append, clear } = useSessionLog()
  const logger = useMemo(() => ({ append, clear }), [append, clear])
  const { state: session, connect, disconnect } = useSshSession({
    logger,
  })

  const errorMessage =
    session.phase === 'error' ? session.error : null
  const publicKey =
    session.phase === 'connected' ? session.publicKey : null

  const statusBadgeClass =
    styles[`statusBadge_${session.phase}`] ?? styles.statusBadge

  const logText = useMemo(() => {
    if (entries.length === 0) {
      return '— idle —'
    }
    return entries.map(formatLogEntry).join('\n')
  }, [entries])

  const handleConnect = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void connect(formState)
    },
    [connect, formState],
  )

  const handleDisconnect = useCallback(() => {
    void disconnect()
  }, [disconnect])

  return (
    <main className={styles.container}>
      <header className={styles.statusBar}>
        <h1 className={styles.heading}>Mana Web SSH Client</h1>
        <div className={styles.statusGroup}>
          <span className={styles.statusLabel}>Status</span>
          <span className={`${styles.statusBadge} ${statusBadgeClass}`}>
            {session.phase === 'connected'
              ? session.connectionState
              : session.phase}
          </span>
        </div>
      </header>

      <form className={styles.form} onSubmit={handleConnect}>
        <label className={styles.field}>
          <span className={styles.label}>Signed WebSocket URL</span>
          <textarea
            className={styles.textarea}
            placeholder="Paste the AWS signed URL here"
            value={formState.signedUrl}
            onChange={(event) =>
              updateField('signedUrl', event.currentTarget.value)
            }
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
              value={formState.host}
              onChange={(event) =>
                updateField('host', event.currentTarget.value)
              }
              required
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Port</span>
            <input
              className={styles.input}
              value={formState.port}
              onChange={(event) =>
                updateField('port', event.currentTarget.value)
              }
              inputMode="numeric"
              pattern="\d*"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Username</span>
            <input
              className={styles.input}
              placeholder="ec2-user"
              value={formState.username}
              onChange={(event) =>
                updateField('username', event.currentTarget.value)
              }
            />
          </label>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="submit"
            className={styles.buttonPrimary}
            disabled={session.phase === 'connecting'}
          >
            {session.phase === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={handleDisconnect}
            disabled={session.phase !== 'connected'}
          >
            Disconnect
          </button>
        </div>
        {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      </form>

      {publicKey && (
        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardTitle}>Client Public Key</span>
            <span className={styles.cardSubtitle}>{publicKey.algorithm}</span>
          </header>
          <code className={styles.cardCode}>{publicKey.openssh}</code>
          <p className={styles.cardHint}>
            Forward this OpenSSH line to AWS Instance Connect using your signed
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
            onClick={clear}
          >
            Clear
          </button>
        </header>
        <pre className={styles.logContent}>{logText}</pre>
      </section>
    </main>
  )
}

export default App
