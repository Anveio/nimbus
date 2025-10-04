import {
  type ConnectedSession,
  type ConnectCallbacks,
  type RuntimeConnectOptions,
  type RuntimeConfigOverrides,
  type TransportBinding,
  buildClientConfig,
  connectWithRuntime,
  createDefaultAlgorithmCatalog,
  createDefaultIdentification,
  createMemoryHostKeyStore,
} from '../runtime'
import type { DiagnosticsSink, HostKeyStore } from '../../api'
import { webcrypto, randomBytes as nodeRandomBytes } from 'node:crypto'

export interface NodeTransportBinding extends TransportBinding {}

export interface NodeConnectOptions {
  transport: NodeTransportBinding
  host?: RuntimeConnectOptions['host']
  configOverrides?: RuntimeConfigOverrides
  callbacks?: ConnectCallbacks
  hostKeys?: HostKeyStore
  diagnostics?: DiagnosticsSink
}

export async function connectSSH(
  options: NodeConnectOptions,
): Promise<ConnectedSession> {
  const callbacks = options.callbacks
  const diagnostics =
    options.diagnostics ??
    (callbacks?.onDiagnostic ? { onRecord: callbacks.onDiagnostic } : undefined)
  const cryptoProvider = resolveNodeCrypto()
  const environment = {
    now: resolveNow,
    randomBytes: (length: number) => new Uint8Array(nodeRandomBytes(length)),
    crypto: cryptoProvider,
    diagnostics,
    hostKeys: options.hostKeys ?? createMemoryHostKeyStore(),
  }
  const configOverrides: RuntimeConfigOverrides = {
    ...(options.configOverrides ?? {}),
  }
  if (diagnostics && !configOverrides.diagnostics) {
    configOverrides.diagnostics = diagnostics
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

export {
  buildClientConfig,
  createDefaultAlgorithmCatalog,
  createDefaultIdentification,
  createMemoryHostKeyStore,
}

export * from '../../api'
export * from '../../errors'

function resolveNodeCrypto(): Crypto {
  if (webcrypto) {
    return webcrypto as Crypto
  }
  if (globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto
  }
  throw new Error('WebCrypto API unavailable in this Node runtime')
}

function resolveNow(): number {
  if (typeof process !== 'undefined' && process.hrtime) {
    const hr = process.hrtime.bigint()
    return Number(hr / 1_000_000n) + Number(hr % 1_000_000n) / 1_000
  }
  return Date.now()
}
