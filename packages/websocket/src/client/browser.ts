import { ensureDefaultProfiles, getProfile } from '../protocol'
import { initialiseConnection } from './internal/connection'
import { makeFactory, type RuntimeWebSocket } from './internal/socket'
import type { Connection, ConnectOptions, WebSocketConstructor } from './types'

export interface BrowserConnectOptions extends ConnectOptions {
  readonly WebSocketImpl?: WebSocketConstructor
}

export async function connect(
  options: BrowserConnectOptions,
): Promise<Connection> {
  const factory = async (): Promise<RuntimeWebSocket> => {
    ensureDefaultProfiles()
    const Implementation = resolveImplementation(options.WebSocketImpl)
    const socketFactory = makeFactory(Implementation)
    return socketFactory.create(options.url, resolveProtocols(options))
  }

  return initialiseConnection(factory, options)
}

function resolveImplementation(
  explicit?: WebSocketConstructor,
): WebSocketConstructor {
  if (explicit) return explicit
  const globalImpl = (globalThis as { WebSocket?: WebSocketConstructor })
    .WebSocket
  if (!globalImpl) {
    throw new Error(
      'No WebSocket implementation available. Provide WebSocketImpl when connecting.',
    )
  }
  return globalImpl
}

function resolveProtocols(
  options: BrowserConnectOptions,
): string | string[] | undefined {
  const resolvedProfile =
    typeof options.profile === 'string'
      ? getProfile(options.profile)
      : (options.profile ?? getProfile('mana.v1'))
  const subs = resolvedProfile?.subprotocols
  if (!subs || subs.length === 0) return undefined
  return Array.from(subs)
}

export type WebSocketLike = RuntimeWebSocket
export type {
  Channel,
  ChannelEvents,
  Connection,
  ConnectionEvents,
  ConnectionState,
  ConnectOptions,
  WebSocketConstructor,
} from './types'
