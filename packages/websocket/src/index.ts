export {
  connect as connectWeb,
  openSshSession as openWebSshSession,
  connectAndOpenSsh as connectAndOpenWebSsh,
} from './client/browser'
export type {
  BrowserConnectOptions,
  BrowserSshBridgeOptions,
  BrowserSshSession,
} from './client/browser'

export {
  connect as connectNode,
  openSshSession as openNodeSshSession,
  connectAndOpenSsh as connectAndOpenNodeSsh,
} from './client/node'
export type {
  NodeConnectOptions,
  NodeSshBridgeOptions,
  NodeSshSession,
} from './client/node'

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
