import { ensureDefaultProfiles, getProfile } from '../protocol'
import { initialiseConnection } from './internal/connection'
import { makeFactory, type RuntimeWebSocket } from './internal/socket'
import type { Connection, ConnectOptions, WebSocketConstructor } from './types'

export interface NodeConnectOptions extends ConnectOptions {
  readonly WebSocketImpl: WebSocketConstructor
}

export async function connect(
  options: NodeConnectOptions,
): Promise<Connection> {
  if (!options.WebSocketImpl) {
    throw new Error('Node client requires WebSocketImpl (e.g., from "ws").')
  }

  const factory = async (): Promise<RuntimeWebSocket> => {
    ensureDefaultProfiles()
    const socketFactory = makeFactory(options.WebSocketImpl)
    return socketFactory.create(options.url, resolveProtocols(options))
  }

  return initialiseConnection(factory, options)
}

function resolveProtocols(
  options: NodeConnectOptions,
): string | string[] | undefined {
  const resolvedProfile =
    typeof options.profile === 'string'
      ? getProfile(options.profile)
      : (options.profile ?? getProfile('mana.v1'))
  const subs = resolvedProfile?.subprotocols
  return subs && subs.length > 0 ? Array.from(subs) : undefined
}

export type {
  Channel,
  ChannelEvents,
  Connection,
  ConnectionEvents,
  ConnectionState,
  ConnectOptions,
  WebSocketConstructor,
} from './types'
