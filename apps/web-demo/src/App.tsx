import {
  useCallback,
  useEffect,
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
import {
  getRemoteSignerConfig,
  requestRemoteSignedUrl,
} from './aws/remote-signer'
import { useSignedUrl } from './signed-url-context'
import { useDiscovery } from './discovery-context'
import type { DiscoveryResult } from './aws/discovery'

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

type DiscoveryInstance = DiscoveryResult['instances'][number]

function resolveInstanceDisplayName(instance: DiscoveryInstance): string {
  return instance.name ?? instance.instanceId
}

function resolveInstanceHost(instance: DiscoveryInstance): string | null {
  return (
    instance.publicDnsName ??
    instance.publicIpAddress ??
    instance.privateIpAddress ??
    null
  )
}

type SigningState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'pending' }
  | { readonly phase: 'success'; readonly timestamp: number }
  | { readonly phase: 'error'; readonly error: string }

function App(): JSX.Element {
  const { state: formState, updateField, patch } = useSshFormState()
  const { entries, append, clear } = useSessionLog()
  const logger = useMemo(() => ({ append, clear }), [append, clear])
  const {
    state: session,
    connect,
    disconnect,
  } = useSshSession({
    logger,
  })
  const { signedUrl, setSignedUrl } = useSignedUrl()
  const {
    region: discoveryRegion,
    setRegion: setDiscoveryRegion,
    query: discoveryQuery,
    isConfigured: isDiscoveryConfigured,
  } = useDiscovery()

  const remoteSigner = useMemo(() => getRemoteSignerConfig(), [])
  const [signingState, setSigningState] = useState<SigningState>({
    phase: 'idle',
  })
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null,
  )

  const discoveryData = discoveryQuery.data
  const discoveryInstances = useMemo(
    () => discoveryData?.instances ?? [],
    [discoveryData],
  )
  const discoveryInstanceConnectCount =
    discoveryData?.instanceConnectEndpoints.length ?? 0
  const resolvedDiscoveryRegion =
    discoveryRegion ?? discoveryData?.region ?? null
  const discoveryIsFetching = discoveryQuery.fetchStatus === 'fetching'
  const discoveryHasError = discoveryQuery.status === 'error'

  const errorMessage = session.phase === 'error' ? session.error : null
  const publicKey = session.phase === 'connected' ? session.publicKey : null

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
      void connect(formState, signedUrl)
    },
    [connect, formState, signedUrl],
  )

  const handleDisconnect = useCallback(() => {
    void disconnect()
  }, [disconnect])

  const handleDiscoveryRegionChange = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      setDiscoveryRegion(trimmed.length > 0 ? trimmed : null)
      updateField('awsRegion', trimmed)
      setSelectedInstanceId(null)
    },
    [setDiscoveryRegion, updateField],
  )

  const handleSelectInstance = useCallback(
    (instance: DiscoveryInstance) => {
      const hostCandidate = resolveInstanceHost(instance)
      if (hostCandidate) {
        updateField('host', hostCandidate)
      }

      if (resolvedDiscoveryRegion) {
        updateField('awsRegion', resolvedDiscoveryRegion)
      }

      setSelectedInstanceId(instance.instanceId)
    },
    [resolvedDiscoveryRegion, updateField],
  )

  useEffect(() => {
    if (!selectedInstanceId) {
      return
    }
    const stillPresent = discoveryInstances.some(
      (instance) => instance.instanceId === selectedInstanceId,
    )
    if (!stillPresent) {
      setSelectedInstanceId(null)
    }
  }, [discoveryInstances, selectedInstanceId])

  const normalizeSigningInputs = useCallback(() => {
    const endpointInput = formState.endpoint.trim()
    if (endpointInput.length === 0) {
      throw new Error('Provide the websocket endpoint before signing.')
    }

    let endpointUrl: URL
    try {
      endpointUrl = new URL(endpointInput)
    } catch {
      throw new Error('Endpoint must be a valid URL (https:// or wss://).')
    }

    if (endpointUrl.protocol !== 'https:' && endpointUrl.protocol !== 'wss:') {
      throw new Error(
        'Endpoint must use https:// or wss:// so the websocket handshake can be signed.',
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

    const fallbackExpires =
      remoteSigner?.defaults.defaultExpires != null
        ? remoteSigner.defaults.defaultExpires
        : 60
    const expiryInput = formState.expiresInSeconds.trim()
    const expiresRaw =
      expiryInput.length === 0
        ? fallbackExpires
        : Number.parseInt(expiryInput, 10)

    if (!Number.isFinite(expiresRaw)) {
      throw new Error('Expires in must be a finite number of seconds.')
    }

    const expiresIn = Math.max(1, Math.floor(expiresRaw))

    return {
      endpoint: endpointUrl.toString(),
      region,
      service,
      expiresIn,
    }
  }, [
    formState.awsRegion,
    formState.awsService,
    formState.endpoint,
    formState.expiresInSeconds,
    remoteSigner,
  ])

  const handleGenerateRemoteSignedUrl = useCallback(async () => {
    if (!remoteSigner) {
      return
    }
    setSigningState({ phase: 'pending' })
    try {
      const normalized = normalizeSigningInputs()
      const expiresLimit = remoteSigner.defaults.maxExpires
      const expiresIn =
        expiresLimit != null
          ? Math.min(normalized.expiresIn, expiresLimit)
          : normalized.expiresIn

      const response = await requestRemoteSignedUrl({
        endpoint: normalized.endpoint,
        region: normalized.region,
        service: normalized.service,
        expiresIn,
      })

      const responseDefaults = response.defaults ?? {}
      const patchedExpires = responseDefaults.defaultExpires ?? expiresIn

      patch({
        endpoint: responseDefaults.endpoint ?? normalized.endpoint,
        awsRegion: responseDefaults.region ?? normalized.region,
        awsService: responseDefaults.service ?? normalized.service,
        expiresInSeconds: String(patchedExpires),
      })
      setSignedUrl(response.signedUrl)

      setSigningState({
        phase: 'success',
        timestamp: Date.now(),
      })
    } catch (error) {
      setSigningState({
        phase: 'error',
        error: describeError(error),
      })
    }
  }, [normalizeSigningInputs, patch, remoteSigner, setSignedUrl])

  const signingMessage = useMemo(() => {
    if (signingState.phase === 'error') {
      return signingState.error
    }
    if (signingState.phase === 'success') {
      return `Remote signer issued a URL at ${new Date(
        signingState.timestamp,
      ).toLocaleTimeString()}.`
    }
    return null
  }, [signingState])

  return (
    <main className={styles.container}>
      <header className={styles.statusBar}>
        <h1 className={styles.heading}>Nimbus Web Terminal</h1>
        <div className={styles.statusGroup}>
          <span className={styles.statusLabel}>Status</span>
          <span className={`${styles.statusBadge} ${statusBadgeClass}`}>
            {session.phase === 'connected'
              ? session.connectionState
              : session.phase}
          </span>
        </div>
      </header>

      <section className={`${styles.card} ${styles.discoveryPanel}`}>
        <div className={styles.discoveryHeader}>
          <div>
            <span className={styles.cardTitle}>AWS Discovery</span>
            <p className={styles.discoveryHint}>
              Load Nimbus-tagged EC2 inventory to prefill the connection form.
            </p>
          </div>
          {isDiscoveryConfigured && (
            <div className={styles.discoveryControls}>
              <label
                className={`${styles.field} ${styles.discoveryRegionControl}`}
              >
                <span className={styles.label}>Region</span>
                <input
                  className={`${styles.input} ${styles.discoveryRegionInput}`}
                  value={discoveryRegion ?? ''}
                  onChange={(event) =>
                    handleDiscoveryRegionChange(event.currentTarget.value)
                  }
                  placeholder={discoveryData?.region ?? 'us-west-2'}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className={`${styles.buttonSecondary} ${styles.discoveryRefresh}`}
                onClick={() => {
                  void discoveryQuery.refetch()
                }}
                disabled={discoveryIsFetching}
              >
                {discoveryIsFetching ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          )}
        </div>
        {isDiscoveryConfigured ? (
          <>
            <div className={styles.discoveryBody}>
              {discoveryIsFetching && discoveryQuery.status === 'pending' ? (
                <p className={styles.discoveryStatus}>
                  Loading discovery data…
                </p>
              ) : discoveryHasError ? (
                <p className={styles.discoveryError}>
                  Unable to load discovery data:{' '}
                  {describeError(discoveryQuery.error)}
                </p>
              ) : discoveryInstances.length > 0 ? (
                <ul className={styles.discoveryList}>
                  {discoveryInstances.map((instance) => {
                    const hostCandidate = resolveInstanceHost(instance)
                    const isSelected =
                      selectedInstanceId === instance.instanceId
                    return (
                      <li
                        key={instance.instanceId}
                        className={`${styles.discoveryInstance} ${
                          isSelected ? styles.discoveryInstance_selected : ''
                        }`}
                      >
                        <div className={styles.discoveryInstanceHeader}>
                          <div className={styles.discoveryInstanceIdentity}>
                            <span className={styles.discoveryInstanceName}>
                              {resolveInstanceDisplayName(instance)}
                            </span>
                            <span className={styles.discoveryInstanceId}>
                              {instance.instanceId}
                            </span>
                          </div>
                          <span className={styles.discoveryInstanceState}>
                            {instance.state ?? 'unknown'}
                          </span>
                        </div>
                        <div className={styles.discoveryInstanceMeta}>
                          {hostCandidate ? (
                            <span>Host: {hostCandidate}</span>
                          ) : (
                            <span>Host: unavailable</span>
                          )}
                          {instance.availabilityZone && (
                            <span>Zone: {instance.availabilityZone}</span>
                          )}
                          {instance.vpcId && <span>VPC: {instance.vpcId}</span>}
                          {instance.subnetId && (
                            <span>Subnet: {instance.subnetId}</span>
                          )}
                        </div>
                        <div className={styles.discoveryInstanceActions}>
                          <button
                            type="button"
                            className={`${styles.discoveryInstanceButton} ${
                              isSelected
                                ? styles.buttonPrimary
                                : styles.buttonSecondary
                            }`}
                            onClick={() => handleSelectInstance(instance)}
                            disabled={!hostCandidate}
                          >
                            {isSelected
                              ? 'Selected'
                              : hostCandidate
                                ? 'Use in form'
                                : 'No routable host'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className={styles.discoveryStatus}>
                  No Nimbus-tagged EC2 instances found for{' '}
                  <code className={styles.discoveryCode}>
                    {discoveryData?.region ?? resolvedDiscoveryRegion ?? '—'}
                  </code>
                  .
                </p>
              )}
            </div>
            <div className={styles.discoveryFooter}>
              <span className={styles.discoveryFootnote}>
                Showing resources for{' '}
                <code className={styles.discoveryCode}>
                  {discoveryData?.region ?? resolvedDiscoveryRegion ?? '—'}
                </code>
                .
              </span>
              {discoveryInstanceConnectCount > 0 && (
                <span className={styles.discoveryFootnote}>
                  {discoveryInstanceConnectCount} Instance Connect endpoint
                  {discoveryInstanceConnectCount === 1 ? '' : 's'} detected.
                </span>
              )}
            </div>
          </>
        ) : (
          <p className={styles.discoveryStatus}>
            Configure{' '}
            <code className={styles.discoveryCode}>
              VITE_MANA_DISCOVERY_ENDPOINT
            </code>{' '}
            and{' '}
            <code className={styles.discoveryCode}>VITE_MANA_SIGNER_TOKEN</code>{' '}
            to enable automatic discovery.
          </p>
        )}
      </section>

      <form className={styles.form} onSubmit={handleConnect}>
        <label className={styles.field}>
          <span className={styles.label}>Signed WebSocket URL</span>
          <textarea
            className={styles.textarea}
            placeholder="Request a signed URL to populate this field"
            value={signedUrl}
            readOnly
            aria-readonly="true"
            rows={4}
          />
        </label>
        <section className={styles.formSection}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>SigV4 Generator</span>
            <p className={styles.sectionHint}>
              {remoteSigner
                ? 'Use the remote signer for one-click SigV4 generation. Requests stay within your AWS account; rotate the signer token by redeploying the stack.'
                : 'Remote signer unavailable. Redeploy the dev infra to regenerate the signer endpoint before requesting SigV4 URLs.'}
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
                  updateField('expiresInSeconds', event.currentTarget.value)
                }
                placeholder="60"
                min={1}
                max={604800}
                step={1}
                autoComplete="off"
              />
            </label>
          </div>
          <div className={styles.sectionActions}>
            {remoteSigner && (
              <button
                type="button"
                className={styles.buttonPrimary}
                onClick={() => {
                  void handleGenerateRemoteSignedUrl()
                }}
                disabled={signingState.phase === 'pending'}
              >
                {signingState.phase === 'pending'
                  ? 'Requesting…'
                  : 'Request signed URL'}
              </button>
            )}
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
          <button type="button" className={styles.buttonGhost} onClick={clear}>
            Clear
          </button>
        </header>
        <pre className={styles.logContent}>{logText}</pre>
      </section>
    </main>
  )
}

export default App
