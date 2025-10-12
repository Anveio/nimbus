# @nimbus/websocket

## Charter
`@nimbus/websocket` defines the canonical WebSocket transport for Nimbus sessions. It standardises the envelope format, heartbeat cadence, and backpressure semantics that every browser client and backend relay must honour. Owning the full stack lets us exercise the protocol under deterministic load, keep telemetry consistent, and validate behaviour against the SSH interpreter in CI.

Authoring toolchain note: each public subpath export advertises a `source` condition that points at its TypeScript implementation. Our tsconfig/vitest configs include that condition so `tsc --noEmit` and unit tests resolve modules without prebuilding. Keep this convention when adding new entry points.

## Distributions
- `client/browser`: A zero-dependency browser client that connects a Nimbus terminal to a remote session over WebSocket. It emits typed control, data, and lifecycle events that bind directly to `@nimbus/vt`, `@nimbus/tui-react`, and the browser SDK in `@nimbus/web`.
- `client/node`: Mirrors the browser contract for headless scenarios (Vitest, Playwright, CLI tooling). Useful for black-box protocol tests and simulating browser peers without DOM requirements. **Runtime note:** browsers are the only first-class environment we support today; Node/Bun/Deno still require user-supplied `WebSocket` polyfills and do not expose `WebSocketStream`, so this adapter is reserved for automated testing until we ship hardened server-side integration docs. Minimum supported Node runtime for this package is v22 LTS to align with the Undici WebSocket baseline.
- `server/node`: A reference Node server that speaks the same protocol to upstream Nimbus clients. It supervises session lifecycles, enforces flow control, and bridges to SSH channels.

Every distribution will ship as a dedicated bundle from `src/` so runtime-specific surfaces (browser, node client, node server) stay lean and tree-shakeable.

> Stub notice: the current client and server factories are intentionally skeletal. They exist only to unblock test harness wiring and may be deleted wholesale once we lock the real transport design.

All three distributions rely on the corresponding surface in `@nimbus/ssh`: browser clients consume `@nimbus/ssh/client/web`, headless clients leverage `@nimbus/ssh/client/node`, and the server delegates to `@nimbus/ssh/server/node` for SSHv2 handshakes, channel multiplexing, and cipher management. Keeping the protocol and SSH primitives in lockstep ensures cross-package updates remain atomic.

## Protocol contract
The transport exchanges discriminated `WireMessage` frames. Data frames tunnel raw SSH payloads, while control frames coordinate heartbeat, window adjustments, feature negotiation, and session teardown. No frame is optional: every client must respond to keep-alive probes and respect backpressure tokens before streaming more data. The shared schema lives in this package so that server and client builds never drift.

## Integration guidance
1. Instantiate the appropriate client (`browser` for React apps, `node` for headless tests) and point it at the WebSocket endpoint exposed by the Nimbus proxy or the embedded reference server.
2. When hosting your own backend, start from `server/node` to inherit sane defaults: zero-trust connection policies, structured logging, and hooks for metrics. Override behaviour via the exported policy interfaces rather than forking the transport layer.
3. Wire the client’s typed events into the SSH core and renderer surfaces. The defaults already speak the Nimbus SSH dialect; additional transforms should live in adapters at the app layer.

## Testing and future work
Our goal is parity tests that spin up the Node server in-process, connect both client builds, and stream scripted SSH fixtures. As the transport matures, add Playwright harnesses that route real terminal traffic through the WebSocket stack to guard against regression. Alternate transports (WebRTC, QUIC) will plug into the same contract once the WebSocket baseline is locked.

- Keep unit tests colocated with the modules they exercise (`src/**/module.test.ts`) to preserve context and reduce drift between implementation and fixtures.
- Phase 2 (next): lock the browser transport contract, integrate with `@nimbus/tui-react` so the terminal web app exercises real SSH traffic, harden resume persistence UX, and add telemetry/Playwright coverage that spans websocket ↔ SSH ↔ renderer.
