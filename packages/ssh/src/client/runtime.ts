import {
  type AlgorithmCatalog,
  type AlgorithmName,
  createClientSession,
  type DiagnosticRecord,
  type DiagnosticsSink,
  type HostIdentity,
  type HostKeyCandidate,
  type HostKeyStore,
  type IdentificationConfig,
  type SshClientConfig,
  type SshEvent,
  type SshSession,
} from '../api'
import { SshInvariantViolation } from '../errors'

export interface TransportBinding {
  send(payload: Uint8Array): void
  onData(listener: (payload: Uint8Array) => void): () => void
  onClose?(
    listener: (summary: { reason?: string; code?: number } | undefined) => void,
  ): (() => void) | undefined
  onError?(listener: (error: unknown) => void): (() => void) | undefined
}

export interface ConnectCallbacks {
  onEvent?(event: SshEvent): void
  onDiagnostic?(record: DiagnosticRecord): void
}

export interface RuntimeConnectOptions {
  transport: TransportBinding
  host?: HostIdentity
  configOverrides?: RuntimeConfigOverrides
  callbacks?: ConnectCallbacks
}

export type RuntimeConfigOverrides = {
  clock?: SshClientConfig['clock']
  randomBytes?: SshClientConfig['randomBytes']
  crypto?: Crypto
  identification?: Partial<IdentificationConfig>
  algorithms?: Partial<AlgorithmCatalog>
  hostKeys?: HostKeyStore
  diagnostics?: DiagnosticsSink
  auth?: SshClientConfig['auth']
  channels?: SshClientConfig['channels']
  guards?: SshClientConfig['guards']
}

export interface MemoryHostKeyStoreOptions {
  readonly trustOnFirstUse?: boolean
}

export function createMemoryHostKeyStore(
  options: MemoryHostKeyStoreOptions = {},
): HostKeyStore {
  const seen = new Map<string, HostKeyCandidate>()
  const trustOnFirstUse = options.trustOnFirstUse ?? true
  return {
    async evaluate(candidate) {
      const key = canonicalHostKeyId(candidate)
      const existing = seen.get(key)
      if (!existing) {
        if (trustOnFirstUse) {
          seen.set(key, candidate)
          return { outcome: 'trusted', source: 'pinned' }
        }
        return { outcome: 'unknown' }
      }
      if (equalBytes(existing.raw, candidate.raw)) {
        return { outcome: 'trusted', source: 'known-hosts' }
      }
      return {
        outcome: 'mismatch',
        severity: 'fatal',
        comment: 'Stored host key does not match candidate',
      }
    },
    async remember(candidate, decision) {
      if (decision.outcome === 'trusted') {
        seen.set(canonicalHostKeyId(candidate), candidate)
      }
    },
  }
}

export function createDefaultIdentification(): IdentificationConfig {
  return {
    clientId: 'SSH-2.0-mana_ssh_0.0.1',
  }
}

export function createDefaultAlgorithmCatalog(): AlgorithmCatalog {
  const asAlgorithm = (value: string): AlgorithmName => value as AlgorithmName
  return {
    keyExchange: [
      asAlgorithm('curve25519-sha256@libssh.org'),
      asAlgorithm('curve25519-sha256'),
      asAlgorithm('diffie-hellman-group14-sha256'),
    ],
    ciphers: [asAlgorithm('aes128-gcm@openssh.com')],
    macs: [asAlgorithm('AEAD_AES_128_GCM'), asAlgorithm('hmac-sha2-256')],
    hostKeys: [
      asAlgorithm('ssh-ed25519'),
      asAlgorithm('rsa-sha2-512'),
      asAlgorithm('rsa-sha2-256'),
    ],
    compression: [asAlgorithm('none')],
    extensions: [asAlgorithm('ext-info-c')],
  }
}

export interface ConnectedSession {
  readonly session: SshSession
  dispose(): void
}

export interface RuntimeEnvironment {
  now: () => number
  randomBytes: (length: number) => Uint8Array
  crypto: Crypto
  diagnostics?: DiagnosticsSink
  hostKeys: HostKeyStore
}

export function buildClientConfig(
  environment: RuntimeEnvironment,
  overrides: RuntimeConfigOverrides = {},
  hostIdentity?: HostIdentity,
): SshClientConfig {
  const identification = {
    ...createDefaultIdentification(),
    ...overrides.identification,
  }
  const algorithms = mergeAlgorithmCatalog(
    createDefaultAlgorithmCatalog(),
    overrides.algorithms,
  )
  const diagnostics = overrides.diagnostics ?? environment.diagnostics
  const hostKeys = overrides.hostKeys ?? environment.hostKeys
  const randomBytes = overrides.randomBytes ?? environment.randomBytes
  const clock = overrides.clock ?? environment.now
  if (!hostKeys) {
    throw new SshInvariantViolation('Host key policy is required')
  }
  const cryptoProvider = overrides.crypto ?? environment.crypto
  if (!cryptoProvider) {
    throw new SshInvariantViolation('Crypto provider is required')
  }
  return {
    clock,
    randomBytes,
    identification,
    algorithms,
    hostKeys,
    diagnostics,
    auth: overrides.auth,
    channels: overrides.channels,
    guards: overrides.guards,
    hostIdentity,
    crypto: cryptoProvider,
  }
}

export async function connectWithRuntime(
  options: RuntimeConnectOptions,
  environment: RuntimeEnvironment,
): Promise<ConnectedSession> {
  const { transport, callbacks, configOverrides, host } = options
  const config = buildClientConfig(environment, configOverrides, host)
  const session = createClientSession(config)

  const disposers: Array<() => void> = []

  const handleEvent = (event: SshEvent) => {
    callbacks?.onEvent?.(event)
    if (event.type === 'outbound-data') {
      flushOutbound(session, transport)
    }
  }

  const eventLoop = (async () => {
    for await (const event of session.events) {
      handleEvent(event)
    }
  })().catch((error) => {
    callbacks?.onDiagnostic?.({
      timestamp: environment.now(),
      level: 'error',
      code: 'event-loop-error',
      message: 'Unhandled error in SSH event loop',
      detail: error,
    })
  })

  drainSyncEvents(session, handleEvent)
  flushOutbound(session, transport)

  const disposeData = transport.onData((payload) => {
    session.receive(payload)
    drainSyncEvents(session, handleEvent)
    flushOutbound(session, transport)
  })
  disposers.push(disposeData)

  const disposeClose = transport.onClose?.((reason) => {
    callbacks?.onDiagnostic?.({
      timestamp: environment.now(),
      level: 'info',
      code: 'transport-closed',
      message: 'Underlying transport closed',
      detail: reason,
    })
    session.close()
  })
  if (disposeClose) {
    disposers.push(disposeClose)
  }

  const disposeError = transport.onError?.((error) => {
    callbacks?.onDiagnostic?.({
      timestamp: environment.now(),
      level: 'error',
      code: 'transport-error',
      message: 'Transport error raised',
      detail: error,
    })
  })
  if (disposeError) {
    disposers.push(disposeError)
  }

  return {
    session,
    dispose(): void {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose?.()
        } catch (error) {
          callbacks?.onDiagnostic?.({
            timestamp: environment.now(),
            level: 'warn',
            code: 'transport-dispose-error',
            message: 'Transport listener cleanup failed',
            detail: error,
          })
        }
      }
      session.dispose()
      void eventLoop
    },
  }
}

function flushOutbound(session: SshSession, transport: TransportBinding): void {
  const batches = session.flushOutbound()
  for (const packet of batches) {
    transport.send(packet)
  }
}

function drainSyncEvents(
  session: SshSession,
  listener: (event: SshEvent) => void,
): void {
  let event: SshEvent | undefined
  while ((event = session.nextEvent())) {
    listener(event)
  }
}

function mergeAlgorithmCatalog(
  base: AlgorithmCatalog,
  overrides?: Partial<AlgorithmCatalog>,
): AlgorithmCatalog {
  if (!overrides) {
    return base
  }
  return {
    keyExchange: overrides.keyExchange ?? base.keyExchange,
    ciphers: overrides.ciphers ?? base.ciphers,
    macs: overrides.macs ?? base.macs,
    hostKeys: overrides.hostKeys ?? base.hostKeys,
    compression: overrides.compression ?? base.compression,
    extensions: overrides.extensions ?? base.extensions,
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    diff |= left ^ right
  }
  return diff === 0
}

function canonicalHostKeyId(candidate: HostKeyCandidate): string {
  return `${candidate.host}:${candidate.port}:${candidate.keyType}`
}
