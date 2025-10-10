import {
  useCallback,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
} from 'react'

import styles from './App.module.css'
import { useSessionLog } from './hooks/use-session-log'
import type { SessionLogEntry } from './hooks/session-log'
import { useSshFormState } from './hooks/use-ssh-form'
import { useSshSession } from './hooks/use-ssh-session'
import { signUrlWithSigV4 } from './aws/sigv4'

function formatLogEntry(entry: SessionLogEntry): string {
  return `${new Date(entry.timestamp).toLocaleTimeString()} ${entry.message}`
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function App(): JSX.Element {
  const { state: formState, updateField, patch } = useSshFormState()
  const { entries, append, clear } = useSessionLog()
  const logger = useMemo(() => ({ append, clear }), [append, clear])
  const { state: session, connect, disconnect } = useSshSession({
    logger,
  })

  const [signingState, setSigningState] = useState<
    | { readonly phase: 'idle' }
    | { readonly phase: 'pending' }
    | { readonly phase: 'success'; readonly timestamp: number }
    | { readonly phase: 'error'; readonly error: string }
  >({ phase: 'idle' })

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

  const handleGenerateSignedUrl = useCallback(async () => {
    setSigningState({ phase: 'pending' })
    try {
      const endpointInput = formState.endpoint.trim()
      if (endpointInput.length === 0) {
        throw new Error('Provide the websocket endpoint before signing.')
      }
      let endpointUrl: URL
      try {
        endpointUrl = new URL(endpointInput)
      } catch {
        throw new Error(
          'Endpoint must be a valid URL (https:// or wss://).',
        )
      }

      if (
        endpointUrl.protocol !== 'https:' &&
        endpointUrl.protocol !== 'wss:'
      ) {
        throw new Error(
          'Endpoint must use https:// or wss:// so the websocket handshake can be signed.',
        )
      }

      const accessKeyId = formState.accessKeyId.trim()
      if (accessKeyId.length === 0) {
        throw new Error('Provide the AWS access key ID before signing.')
      }

      const secretAccessKey = formState.secretAccessKey.trim()
      if (secretAccessKey.length === 0) {
        throw new Error(
          'Provide the AWS secret access key before signing.',
        )
      }

      const region = formState.awsRegion.trim()
      if (region.length === 0) {
        throw new Error('AWS region is required for SigV4 signing.')
      }

      const service = formState.awsService.trim()
      if (service.length === 0) {
        throw new Error('AWS service identifier is required for signing.')
      }

      const expiryInput = formState.expiresInSeconds.trim()
      const expiresIn =
        expiryInput.length === 0
          ? 60
          : Number.parseInt(expiryInput, 10)

      if (!Number.isFinite(expiresIn)) {
        throw new Error('Expires in must be a finite number of seconds.')
      }

      const sessionToken = formState.sessionToken.trim()

      const signed = await signUrlWithSigV4({
        url: endpointUrl.toString(),
        region,
        service,
        expiresIn,
        credentials: {
          accessKeyId,
          secretAccessKey,
          sessionToken: sessionToken.length > 0 ? sessionToken : undefined,
        },
      })

      patch({ signedUrl: signed })
      setSigningState({ phase: 'success', timestamp: Date.now() })
    } catch (error) {
      setSigningState({
        phase: 'error',
        error: describeError(error),
      })
    }
  }, [
    formState.accessKeyId,
    formState.awsRegion,
    formState.awsService,
    formState.endpoint,
    formState.expiresInSeconds,
    formState.secretAccessKey,
    formState.sessionToken,
    patch,
  ])

  const signingMessage = useMemo(() => {
    if (signingState.phase === 'error') {
      return signingState.error
    }
    if (signingState.phase === 'success') {
      return `Signed at ${new Date(signingState.timestamp).toLocaleTimeString()} and copied above.`
    }
    return null
  }, [signingState])

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
        <section className={styles.formSection}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>SigV4 Generator</span>
            <p className={styles.sectionHint}>
              Paste temporary AWS credentials to presign the websocket
              endpoint. Nothing leaves your browser—revoke credentials
              when you are finished.
            </p>
          </header>
          <div className={styles.fieldGroup}>
            <label className={styles.field}>
              <span className={styles.label}>Endpoint</span>
              <input
                className={styles.input}
                value={formState.endpoint}
                onChange={(event) =>
                  updateField('endpoint', event.currentTarget.value)
                }
                placeholder="wss://prod.us-west-2.oneclickv2-proxy.ec2.aws.dev/proxy/instance-connect"
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Region</span>
              <input
                className={styles.input}
                value={formState.awsRegion}
                onChange={(event) =>
                  updateField('awsRegion', event.currentTarget.value)
                }
                placeholder="us-west-2"
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Service</span>
              <input
                className={styles.input}
                value={formState.awsService}
                onChange={(event) =>
                  updateField('awsService', event.currentTarget.value)
                }
                placeholder="ec2-instance-connect"
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Expires (seconds)</span>
              <input
                className={styles.input}
                type="number"
                value={formState.expiresInSeconds}
                onChange={(event) =>
                  updateField(
                    'expiresInSeconds',
                    event.currentTarget.value,
                  )
                }
                placeholder="60"
                min={1}
                max={604800}
                step={1}
                autoComplete="off"
              />
            </label>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.field}>
              <span className={styles.label}>Access Key ID</span>
              <input
                className={styles.input}
                value={formState.accessKeyId}
                onChange={(event) =>
                  updateField('accessKeyId', event.currentTarget.value)
                }
                placeholder="ASIA..."
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Secret Access Key</span>
              <input
                className={styles.input}
                type="password"
                value={formState.secretAccessKey}
                onChange={(event) =>
                  updateField(
                    'secretAccessKey',
                    event.currentTarget.value,
                  )
                }
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Session Token</span>
              <textarea
                className={styles.textarea}
                value={formState.sessionToken}
                onChange={(event) =>
                  updateField('sessionToken', event.currentTarget.value)
                }
                rows={3}
                placeholder="Paste when using temporary credentials"
              />
            </label>
          </div>
          <div className={styles.sectionActions}>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => {
                void handleGenerateSignedUrl()
              }}
              disabled={signingState.phase === 'pending'}
            >
              {signingState.phase === 'pending'
                ? 'Generating…'
                : 'Generate signed URL'}
            </button>
            {signingMessage && (
              <p
                className={`${styles.signingStatus} ${
                  signingState.phase === 'error'
                    ? styles.signingStatus_error
                    : styles.signingStatus_success
                }`}
              >
                {signingMessage}
              </p>
            )}
          </div>
        </section>
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
