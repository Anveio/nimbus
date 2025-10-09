# Transport Integration Contract (Phase 2)

This note codifies how the SSH engine composes with transports (e.g. the Phase‑2 `@mana/websocket` client). It describes the responsibilities of both sides, the baseline runtime wiring, and the resume story we are building toward.

## Runtime Entrypoints

`@mana/ssh` exposes runtime-specific helpers that wrap the core `createClientSession` API:

- `@mana/ssh/client/web` – browser/worker default wiring (`connectSSH`; callers provide a `TransportBinding`).
- `@mana/ssh/client/node` – Node 18+ runtime wiring (`connectSSH`).
- Both build on shared primitives from `src/client/shared`.

`connectSSH(options)` expects:

```ts
interface TransportBinding {
  send(payload: Uint8Array): void
  onData(listener: (payload: Uint8Array) => void): () => void
  onClose?(listener: (summary?: { code?: number; reason?: string }) => void):
    | (() => void)
    | void
  onError?(listener: (error: unknown) => void): (() => void) | void
}

interface ClientPublicKeyReadyEvent {
  readonly type: 'client-public-key-ready'
  readonly algorithm: string
  readonly publicKey: Uint8Array
  readonly comment?: string
}

interface ConnectCallbacks {
  onEvent?(event: SshEvent): void
  onDiagnostic?(record: DiagnosticRecord): void
  onClientPublicKeyReady?(event: ClientPublicKeyReadyEvent): void
}

interface RuntimeConnectOptions {
  transport: TransportBinding
  host?: HostIdentity
  configOverrides?: RuntimeConfigOverrides
  callbacks?: ConnectCallbacks
  resume?: ResumeConfig
}

interface ResumeConfig {
  readonly enable?: boolean
  onPersist?(state: ResumeState): void | Promise<void>
  onLoad?(): ResumeState | undefined | Promise<ResumeState | undefined>
  onClear?(): void | Promise<void>
}

interface ResumeState {
  readonly token: string
  readonly expiresAt?: number
  readonly sessionId?: string
  readonly channels?: ReadonlyArray<{ readonly id: number; readonly window: number }>
}
```

The runtime adapters inject defaults for:

- `clock`: `performance.now()` (browser) / `process.hrtime.bigint()` (node).
- `randomBytes`: `crypto.getRandomValues` (browser) / `crypto.randomBytes` (node).
- `crypto`: WebCrypto (`globalThis.crypto` / `crypto.webcrypto`).
- `hostKeys`: IndexedDB-backed persistence in browsers (configurable via `hostKeyConfig`), in-memory TOFU for Node.
- `client-public-key-ready`: emitted via `callbacks.onClientPublicKeyReady` (and the general `onEvent` stream) whenever the engine prepares a client authentication key so transports or hosts can propagate it (e.g., AWS Instance Connect). The runtime calls the specialised callback first, then forwards the same event object through `onEvent`, so consumers can mix-and-match without missing notifications.
- `resume`: optional callbacks that will orchestrate token persistence once the SSH core begins emitting resume metadata.
- `diagnostics`: forwards into `callbacks.onDiagnostic` when provided.

Consumers may override any portion of the `SshClientConfig` (identification string, algorithm catalog, channel policy, authentication strategy, guards) through `configOverrides`.

`connectSSH` resolves the runtime config, creates a session, wires transport event handlers, and starts an async consumer that:

1. Feeds inbound octets via `session.receive`.
2. Flushes outbound buffers whenever the session emits `outbound-data` events or after synchronous commands.
3. Surfaces `SshEvent`s and diagnostics to the caller.
4. Registers the disposer hooks returned by `onData`/`onClose`/`onError` so callers can tear everything down with a single `dispose()` call (important for reconnect loops).
5. Closes the session if the transport terminates.

The helper returns `{ session, dispose }`. Hosts are free to continue using `session.command`, `session.flushOutbound`, and the async iterator directly (e.g. to build custom pumps or to multiplex additional telemetry).

## Transport Responsibilities

A transport wrapper (WebSocket, QUIC, fixed TCP) must:

- Deliver raw SSH payloads as `Uint8Array` via `onData` in FIFO order.
- Backpressure according to its own policy; `connectSSH` does not apply rate limiting beyond SSH window semantics.
- Route outbound buffers from `connectSSH` straight onto the wire; the helper already frames packets and handles encryption.
- Propagate close/error conditions, allowing the SSH layer to emit diagnostics and shut down cleanly.
- Surface a `HostIdentity` (`host`, `port`) so host key evaluation and diagnostics mirror the actual peer.

When targeting browsers, wire DOM primitives into a `TransportBinding` before invoking `connectSSH`. A WebSocket example:

```ts
// @mana/ssh/client/web exports the TransportBinding type alias.
import type { WebTransportBinding } from '@mana/ssh/client/web'

export function createWebSocketTransport(socket: WebSocket): WebTransportBinding {
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
        }
      }
      socket.addEventListener('message', handler)
      return () => socket.removeEventListener('message', handler)
    },
    onClose(listener) {
      if (!listener) {
        return
      }
      const handler = (event: CloseEvent) => {
        listener({ reason: event.reason, code: event.code })
      }
      socket.addEventListener('close', handler)
      return () => socket.removeEventListener('close', handler)
    },
    onError(listener) {
      if (!listener) {
        return
      }
      const handler = (event: Event) => {
        listener((event as { error?: unknown }).error ?? event)
      }
      socket.addEventListener('error', handler)
      return () => socket.removeEventListener('error', handler)
    },
  }
}
```

Other transports (Fetch streams, SharedArrayBuffer pipes, QUIC channels) follow the same shape: deliver octets through `onData`, surface lifecycle events, and push outbound buffers via `send`.

### Host Key Persistence Options

Configure persistence through `hostKeyConfig`:

- `persistence: 'indexeddb'` (default) stores trusted host keys in IndexedDB so TOFU decisions survive reloads. Customise the database/store names via `databaseName`/`storeName`, provide a custom `indexedDB` factory when running in sandboxed contexts, or disable automatic TOFU via `trustOnFirstUse: false` and call `hostKeys.remember` manually.
- `persistence: 'memory'` falls back to the in-memory TOFU store used by Node clients.
- `persistence: 'disabled'` opts out entirely; callers must supply `hostKeys` and handle trust decisions themselves.

## Channel Lifecycle Expectations

The Phase‑2 websocket client needs PTY setup, shell startup, and exec flows. The engine now exposes:

- `session.command({ type: 'request-channel', request: ChannelRequestPayload })` to emit `SSH_MSG_CHANNEL_REQUEST` for `pty-req`, `shell`, and `exec`.
- `SshEvent` variants:
  - `channel-request` (success/failure with the originating payload).
  - `channel-exit-status` and `channel-exit-signal` (emitted immediately when the server notifies exit conditions).

Transports/watchers should observe these events to resolve promises exposed to UI layers and to terminate renderer pipelines promptly when the remote process exits.

## Resume (Transport-Owned)

Phase‑2 keeps resume logic entirely inside transports. The SSH engine and its runtime adapters remain stateless: they never store, load, or generate resume tokens, and `connectSSH` continues to return only `{ session, dispose }`.

- Websocket (and future) transports own persistence. They decide when to capture tokens (e.g., from `open_ok.resumeKey`), which storage medium to use, and how to replay snapshots on reconnect.
- Because the SSH session already supports `receive`, `flushOutbound`, and `waitForIdle()` without hidden buffers, transports can safely pause IO during reconnects and resume once the wire protocol is back.
- When the SSH core eventually emits resume-ready snapshots, those events will surface through normal `SshEvent` channels; runtime adapters will stay pass-through so transports can continue making independent policy decisions.

For guidance on the websocket contract—including hello payloads and resume token flow—see `packages/websocket/docs/technical-design-spec.md`.

## Build & Packaging Plan

- Library builds run through Vite in “library mode”, emitting dual-format bundles (`dist/**/*.js` for ESM and `.cjs` for CommonJS) for the core, browser adapter, node adapter, and server bindings.
- `vite-plugin-dts` rolls declaration files into the same layout (`dist/index.d.ts`, `dist/client/web.d.ts`, etc.) so the `exports` map advertises a complete surface.
- `package.json` now points `main`/`module`/`types` at the built artefacts and the `files` whitelist only ships `dist/**` to npm.
- Source maps are generated for both formats to aid debugging inside downstream bundlers.
- The build runs as part of `prepublishOnly`; local development can continue hitting `src/` through the workspace resolution.
