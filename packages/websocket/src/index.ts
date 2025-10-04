export { connect as connectWeb } from './client/browser'
export type { BrowserConnectOptions } from './client/browser'

export { connect as connectNode } from './client/node'
export type { NodeConnectOptions } from './client/node'

export { createNodeWebSocketServer } from './server/node'
export type {
  NodeWebSocketServer,
  NodeWebSocketServerOptions,
  WebSocketServerFactory,
  WebSocketServerLike,
} from './server/node'

export type {
  Connection,
  ConnectionState,
  ConnectionEvents,
  Channel,
  ChannelEvents,
  ConnectOptions,
} from './client/types'
