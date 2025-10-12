const guidance = `@nimbus/websocket does not expose a root entry point.

Pick the runtime-specific client instead:
- Browser runtimes: import { connect } from '@nimbus/websocket/client/web'
- Node runtimes: import { connect } from '@nimbus/websocket/client/node'
- Node servers: import { createNodeWebSocketServer } from '@nimbus/websocket/server/node'

Each bundle ships different transports and side-effects, so selecting the precise entry point keeps your build lean and standards compliant.

See docs: packages/websocket/docs/technical-design-spec.md#public-entrypoints`

throw new Error(guidance)

export type DoNotUseWebsocketRootEntryPoint = never
