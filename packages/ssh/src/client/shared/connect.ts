import {
  type AlgorithmCatalog,
  createClientSession,
  type DiagnosticRecord,
  type DiagnosticsSink,
  type HostIdentity,
  type HostKeyStore,
  type IdentificationConfig,
  type ResolvedIdentity,
  type SshClientConfig,
  type SshEvent,
  type SshSession,
} from '../../api'
import { SshInvariantViolation } from '../../errors'
import {
  createDefaultAlgorithmCatalog,
  createDefaultIdentification,
} from './defaults'
import { createMemoryHostKeyStore } from './memory-host-key-store'

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
  identity?: ResolvedIdentity
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
  hostKeys?: HostKeyStore
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
  const hostKeys =
    overrides.hostKeys ?? environment.hostKeys ?? createMemoryHostKeyStore()
  const randomBytes = overrides.randomBytes ?? environment.randomBytes
  const clock = overrides.clock ?? environment.now
  if (!hostKeys) {
    throw new SshInvariantViolation('Host key policy is required')
  }
  const cryptoProvider = overrides.crypto ?? environment.crypto
  if (!cryptoProvider) {
    throw new SshInvariantViolation('Crypto provider is required')
  }
  const identity = overrides.identity
  if (!identity) {
    throw new SshInvariantViolation('Client identity is required')
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
    identity,
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

export {
  createDefaultAlgorithmCatalog,
  createDefaultIdentification,
  createMemoryHostKeyStore,
}
