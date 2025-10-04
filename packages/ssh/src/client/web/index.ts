import type { DiagnosticsSink, HostKeyStore } from '../../api'
import {
  buildClientConfig,
  type ConnectCallbacks,
  type ConnectedSession,
  connectWithRuntime,
  createDefaultAlgorithmCatalog,
  createDefaultIdentification,
  createMemoryHostKeyStore,
  type RuntimeConfigOverrides,
  type RuntimeConnectOptions,
  type TransportBinding,
} from '../runtime'

export interface WebTransportBinding extends TransportBinding {}

export interface WebConnectOptions {
  transport: WebTransportBinding
  host?: RuntimeConnectOptions['host']
  configOverrides?: RuntimeConfigOverrides
  callbacks?: ConnectCallbacks
  hostKeys?: HostKeyStore
  diagnostics?: DiagnosticsSink
}

export function createWebTransport(socket: WebSocket): WebTransportBinding {
  socket.binaryType = 'arraybuffer'
  return {
    send(payload) {
      socket.send(payload)
    },
    onData(listener) {
      const handler = (event: MessageEvent) => {
        const data = event.data
        if (data instanceof ArrayBuffer) {
          listener(new Uint8Array(data))
          return
        }
        if (ArrayBuffer.isView(data)) {
          const view = data as ArrayBufferView
          listener(
            new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
          )
          return
        }
        if (typeof data === 'string') {
          listener(new TextEncoder().encode(data))
          return
        }
      }
      socket.addEventListener('message', handler)
      return () => {
        socket.removeEventListener('message', handler)
      }
    },
    onClose(listener) {
      if (!listener) {
        return
      }
      const handler = (event: CloseEvent) => {
        listener({ reason: event.reason, code: event.code })
      }
      socket.addEventListener('close', handler)
      return () => {
        socket.removeEventListener('close', handler)
      }
    },
    onError(listener) {
      if (!listener) {
        return
      }
      const handler = (event: Event) => {
        listener((event as { error?: unknown }).error ?? event)
      }
      socket.addEventListener('error', handler)
      return () => {
        socket.removeEventListener('error', handler)
      }
    },
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
  const environment = {
    now: resolveNow,
    randomBytes: (length: number) => {
      const bytes = new Uint8Array(length)
      cryptoProvider.getRandomValues(bytes)
      return bytes
    },
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
