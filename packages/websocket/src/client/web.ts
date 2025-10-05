// Public web client entry point that aliases the browser implementation.
export {
  connect,
  openSshSession,
  connectAndOpenSsh,
} from './browser'

export type {
  BrowserConnectOptions,
  BrowserSshBridgeOptions,
  BrowserSshSession,
  WebSocketLike,
} from './browser'

export type {
  Channel,
  ChannelEvents,
  Connection,
  ConnectionEvents,
  ConnectionState,
  ConnectOptions,
  WebSocketConstructor,
} from './types'
