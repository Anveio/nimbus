import type {
  DiagnosticsSink,
  HostKeyStore,
  SshIdentityConfig,
} from '../../api'
import {
  type ConnectCallbacks,
  type ConnectedSession,
  connectWithRuntime,
  createMemoryHostKeyStore,
  type RuntimeConfigOverrides,
  type RuntimeConnectOptions,
  type TransportBinding,
} from '../shared/connect'
import { resolveIdentityConfig } from '../shared/identity'
import { createIndexedDbHostKeyStore } from './host-key-store'

export interface WebTransportBinding extends TransportBinding {}

export interface WebConnectOptions {
  transport: WebTransportBinding
  host?: RuntimeConnectOptions['host']
  configOverrides?: RuntimeConfigOverrides
  callbacks?: ConnectCallbacks
  hostKeys?: HostKeyStore
  diagnostics?: DiagnosticsSink
  identity?: SshIdentityConfig
  hostKeyConfig?: {
    readonly persistence?: 'indexeddb' | 'memory' | 'disabled'
    readonly databaseName?: string
    readonly storeName?: string
    readonly trustOnFirstUse?: boolean
    readonly indexedDB?: IDBFactory
  }
}

export async function connectSSH(
  options: WebConnectOptions,
): Promise<ConnectedSession> {
  const callbacks = options.callbacks
  const diagnostics =
    options.diagnostics ??
    (callbacks?.onDiagnostic ? { onRecord: callbacks.onDiagnostic } : undefined)
  const cryptoProvider = resolveWebCrypto()
  const hostKeyConfig = options.hostKeyConfig ?? {}
  const persistence = hostKeyConfig.persistence ?? 'indexeddb'
  let hostKeys = options.hostKeys
  if (!hostKeys) {
    if (persistence === 'indexeddb') {
      hostKeys = await createIndexedDbHostKeyStore({
        databaseName: hostKeyConfig.databaseName,
        storeName: hostKeyConfig.storeName,
        trustOnFirstUse: hostKeyConfig.trustOnFirstUse,
        indexedDB: hostKeyConfig.indexedDB,
      })
    } else if (persistence === 'memory') {
      hostKeys = createMemoryHostKeyStore()
    } else {
      throw new Error(
        'Host key persistence is disabled but no hostKeys store was provided. Supply options.hostKeys to manage host keys manually.',
      )
    }
  }
  const environment = {
    now: resolveNow,
    randomBytes: (length: number) => {
      const bytes = new Uint8Array(length)
      cryptoProvider.getRandomValues(bytes)
      return bytes
    },
    crypto: cryptoProvider,
    diagnostics,
    hostKeys,
  }

  const configOverrides: RuntimeConfigOverrides = {
    ...(options.configOverrides ?? {}),
  }
  if (diagnostics && !configOverrides.diagnostics) {
    configOverrides.diagnostics = diagnostics
  }
  if (!configOverrides.identity) {
    if (!options.identity) {
      throw new Error(
        'connectSSH requires options.identity with username information for public key authentication',
      )
    }
    configOverrides.identity = await resolveIdentityConfig(
      cryptoProvider,
      options.identity,
    )
  }

  return connectWithRuntime(
    {
      transport: options.transport,
      host: options.host,
      configOverrides,
      callbacks,
    },
    environment,
  )
}

export * from '../../api'
export * from '../../errors'

function resolveWebCrypto(): Crypto {
  const provider = globalThis.crypto
  if (!provider || !provider.subtle || !provider.getRandomValues) {
    throw new Error('WebCrypto API is not available in this environment')
  }
  return provider
}

function resolveNow(): number {
  if (
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
  ) {
    return performance.now()
  }
  return Date.now()
}
