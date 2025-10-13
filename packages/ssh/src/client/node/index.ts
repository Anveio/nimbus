import { randomBytes as nodeRandomBytes, webcrypto } from 'node:crypto'
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

export interface NodeTransportBinding extends TransportBinding {}

export interface NodeConnectOptions {
  transport: NodeTransportBinding
  host?: RuntimeConnectOptions['host']
  configOverrides?: RuntimeConfigOverrides
  callbacks?: ConnectCallbacks
  hostKeys?: HostKeyStore
  diagnostics?: DiagnosticsSink
  identity?: SshIdentityConfig
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

function resolveNodeCrypto(): Crypto {
  if (webcrypto) {
    return webcrypto as Crypto
  }
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto
  }
  throw new Error('WebCrypto API unavailable in this Node runtime')
}

function resolveNow(): number {
  if (process?.hrtime) {
    const hr = process.hrtime.bigint()
    return Number(hr / 1_000_000n) + Number(hr % 1_000_000n) / 1_000
  }
  return Date.now()
}
