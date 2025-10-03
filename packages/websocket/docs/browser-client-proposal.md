# WebSocket SSH Client Proposal

## Intent
This document captures the initial surface area for the browser WebSocket transport that bridges Mana terminals to remote SSH sessions. The goal is to give app developers a batteries-included client that hides wire details yet keeps the door open for higher-level orchestration once the SSH core exposes full channel control. The proposal now codifies lifecycle, security, codec, and diagnostics guarantees so the public API can ship as a stable, testable transport layer.

## Goals
- **One-line bootstrap:** Consumer code should look like `const client = createWebSocketSshClient(config); await client.connect();` followed by `client.write("ls\n")`.
- **Typed events for host integration:** Expose a small set of events that mirror key SSH milestones (handshake, authentication prompts, channel data, disconnect) without leaking packet formats.
- **Minimal configuration:** Require only a WebSocket endpoint; algorithm preferences, codec selection, and resilience policies ship with defaults that cover modern OpenSSH hosts.
- **Resilience-first defaults:** Handle retries, heartbeats, and session teardown internally so inexperienced developers can keep terminals alive through transient drops.

## Non-goals (for this iteration)
- Custom backpressure tuning hooks. The transport will implement flow control internally, but the configuration surface will stay hidden until we evaluate production needs.
- Diagnostics sinks or structured logging callbacks beyond the minimal telemetry hook defined here. A broader observability surface will arrive in a later milestone.
- Server design. This proposal only covers the browser client; the Node server document will extend the protocol contract once drafted.

## Public API sketch

```ts
type AlgorithmSuiteOverrides = Pick<AlgorithmCatalog,
  'keyExchange' | 'hostKeys' | 'ciphers' | 'macs' | 'compression'
>

type TransportPhase =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'ready'
  | 'reconnecting'
  | 'failed'
  | 'closed'

interface TransportFailure {
  readonly phase: TransportPhase
  readonly reason:
    | DisconnectSummary
    | 'timeout'
    | 'handshake-error'
    | 'policy-exhausted'
    | 'protocol-error'
  readonly cause?: unknown
}

interface TransportDiagnosticEvent {
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly phase: TransportPhase
  readonly message: string
  readonly data?: Record<string, unknown>
  readonly timestamp: number
}

interface TransportFrame {
  readonly kind: 'data' | 'control'
  readonly payload: Uint8Array
}

interface FrameCodec {
  /** Unique identifier (`name:version`) to support negotiation and telemetry. */
  readonly id: `${string}:${number}`
  /** Encodes a transport frame into a WebSocket-ready binary payload. */
  encode(frame: TransportFrame): ArrayBufferLike
  /** Decodes an incoming WebSocket payload or throws on contract violations. */
  decode(data: ArrayBufferLike): TransportFrame
}

export interface WebSocketSshClientConfig {
  /** ws[s] endpoint. Accepts string or URL to support dynamic construction. */
  readonly endpoint: string | URL

  /** Optional bearer token or header set for auth proxies. */
  readonly credentials?: {
    readonly token?: string
    readonly headers?: Readonly<Record<string, string>>
  }

  /** Preferred algorithm suites forwarded to @mana/ssh. Overrides merge with shipped defaults. */
  readonly algorithms?: Partial<AlgorithmSuiteOverrides>

  /** Optional reconnection policy; defaults keep exponential backoff + jitter. */
  readonly reconnectPolicy?: Partial<{
    readonly enabled: boolean
    readonly maxAttempts: number
    readonly baseDelayMs: number
    readonly maxDelayMs: number
  }>

  /** Optional overrides passed into createClientSession once advanced features land. */
  readonly ssh?: Partial<Pick<SshClientConfig, 'channels' | 'auth' | 'guards'>>

  /** Minimal telemetry hook for host-controlled logging. */
  readonly diagnostics?: {
    readonly logger?: (event: TransportDiagnosticEvent) => void
  }

  /** Advanced: override the default frame codec for custom transports. */
  readonly frameCodec?: FrameCodec
}

export interface WebSocketSshClient {
  /** Current lifecycle phase for UI feedback. */
  readonly state: TransportPhase

  /** Most recent terminal failure, retained until the next successful connect cycle. */
  readonly lastError: TransportFailure | null

  /** Active frame codec. Useful for telemetry and compatibility checks. */
  readonly codec: FrameCodec

  /** Async stream of transport events for observers. */
  readonly events: AsyncIterable<TransportEvent>

  /** Optional ergonomic helper for imperative subscriptions. Returns an unsubscribe handle. */
  on<EventType extends TransportEvent['type']>(
    type: EventType,
    handler: (
      event: Extract<TransportEvent, { type: EventType }>
    ) => void
  ): () => void

  /** Opens the WebSocket, drives SSH handshake, resolves when the session channel is ready. */
  connect(signal?: AbortSignal): Promise<void>

  /** Shortcut for writing data to the default session channel. */
  write(data: string | Uint8Array): void

  /** Optional helper for PTY resize once channel support lands. No-ops until window management is available. */
  resize(columns: number, rows: number): void

  /** Imperative tear-down. Closes both SSH session and WebSocket transports. */
  dispose(): void

  /** Convenience promise for consumers who prefer awaiting readiness. */
  waitForReady(signal?: AbortSignal): Promise<void>
}
```

```ts
export type TransportEvent =
  | { type: 'connected'; resume: boolean }
  | { type: 'keys-established'; algorithms: NegotiatedAlgorithms }
  | { type: 'auth-required'; methods: ReadonlyArray<string> }
  | { type: 'data'; payload: Uint8Array }
  | { type: 'disconnect'; reason?: DisconnectSummary }
  | { type: 'reconnecting'; attempt: number; delayMs: number }
  | { type: 'error'; failure: TransportFailure }
```

These events keep the default experience approachable (subscribe to `data`, write strings) while allowing future layering (auth flows, structured reconnect UI and diagnostics). `error` events are emitted once per terminal failure, immediately before transitioning to `failed` or `closed`.

### Frame codec configuration
- The client ships with a canonical `mana-default:1` codec that wraps SSH payloads and transport control frames in a binary envelope. This codec is considered the interoperability baseline for Mana hosts and server transports.
- `frameCodec` may be supplied to experiment with alternate envelopes (for example, a QUIC-ready framing or integration with an existing proxy). Custom codecs must round-trip `TransportFrame` structures and are expected to negotiate out-of-band compatibility with the server.
- The active codec is surfaced via `client.codec` so hosts can log, verify, or enforce policy. If the supplied codec throws during `decode`, the transport emits an `error` with `reason: 'protocol-error'` and moves to `failed`.
- Future protocol additions (resume markers, security challenges) will land in the default codec first. Custom codecs are responsible for re-encoding those control frames when upgrading to newer versions.

## Canonical codec `mana-default:1`

`mana-default:1` is the reference codec backing browser ↔ server interoperability. Both sides must implement it; alternative codecs are opt-in and negotiated by the host application.

### Requirements and invariants
- Frames must be self-delimiting and reject corruption quickly.
- Data frames must carry raw SSH binary payloads without mutation.
- Control frames must support resumability, heartbeat, and transport diagnostics without leaking into the SSH channel.
- Codec metadata has to be versioned so future evolutions can coexist with 1.0 endpoints.
- Maximum payload length is capped at 1 MiB per frame to avoid unbounded buffering; larger SSH packets are fragmented by the sender.

### Frame layout
The codec emits a fixed 14-byte header followed by the payload. All multi-byte integers are big-endian.

| Offset | Size | Field | Description |
| --- | --- | --- | --- |
| 0 | 2 | `magic` | Constant `0x6d61` (`"ma"`). Any other value is a fatal codec error. |
| 2 | 1 | `version` | Upper nibble = major (1), lower nibble = minor (0). Receivers MUST close on unknown major versions and MAY warn on higher minor versions. |
| 3 | 1 | `type` | `0x00` = data, `0x01` = control. All other values are reserved and treated as fatal. |
| 4 | 1 | `flags` | Bit `0` (`FIN`) marks end-of-message; bit `1` (`CHECKPOINT`) requests resume token refresh; remaining bits MUST be zero. |
| 5 | 1 | `reserved` | MUST be zero; receivers treat non-zero as fatal. |
| 6 | 4 | `length` | Payload length in bytes (0–1,048,576). Values outside this range are rejected. |
| 10 | 4 | `sequence` | Monotonic counter scoped to the transport session. Wrap-around closes the connection with protocol error. |

The payload immediately follows the header.

### Data frame semantics
- `type = 0x00`.
- Payload is the raw SSH binary fragment emitted by `@mana/ssh`.
- Frames MUST preserve ordering; the receiver enqueues data strictly by `sequence`.
- `FIN` indicates the sender flushed an internal buffer (for example after newline). Hosts may use it as a heuristic for UI updates but MUST NOT assume message boundaries.

### Control frame semantics
- `type = 0x01` and payload begins with an opcode byte followed by canonical CBOR (RFC 8949) map data.
- Opcode namespace (values 0x80–0xFF are reserved for future private use; 0x00–0x7F are public):
  - `0x01` **HELLO** (bi-directional): announces `codec` (string), `session` (bstr ≤16 bytes), optional `capabilities` (array of strings), and optional `resumeToken` (bstr). Each side MUST emit HELLO within the first second after WebSocket open. Mismatched `codec` values require a `CLOSE_HINT` frame followed by socket termination.
  - `0x02` **HEARTBEAT** (bi-directional): includes `nonce` (uint) and optional `latency` (uint). Receivers echo the same payload back to acknowledge liveness. Missing acknowledgements trip reconnect timers.
  - `0x03` **RESUME_TICKET** (server → client): provides `token` (bstr) and optional `expires` (uint seconds). Clients store the token for future reconnect attempts and emit `reconnecting` events with `resume=false` if absent.
  - `0x04` **CLOSE_HINT** (server → client): carries `code` (uint), `reason` (tstr), and optional `retryAfter` (uint milliseconds). Clients surface the reason via `TransportEvent` and honour `retryAfter` when computing backoff.
  - `0x05` **ERROR_REPORT** (bi-directional): provides `category` (tstr), `details` (map), and is purely informational; it does not alter state but feeds diagnostics.
- Control CBOR maps MUST use text-string keys for readability (`"codec"`, `"session"`, etc.) and canonical ordering. Unknown keys are ignored.
- `CHECKPOINT` flag is valid for RESUME_TICKET frames; receivers persist the supplied token atomically before acknowledging queued writes.

### Negotiation and lifecycle
- The client selects a preferred codec (default `mana-default:1`) before opening the WebSocket.
- After the socket opens, both sides exchange HELLO frames. If both advertise the same codec ID, the session proceeds. Otherwise, the endpoint detecting the mismatch sends `CLOSE_HINT` with `code = 4600` (`codec-mismatch`) and closes the connection.
- `sequence` starts at zero for the first frame after HELLO and increments by one for every transmitted frame, regardless of type. Receivers drop duplicate or out-of-order frames and emit a protocol `error`.
- Heartbeat cadence is derived from transport config (default 10 seconds). Missing two consecutive acknowledgements triggers reconnect.
- Resume tokens conveyed via RESUME_TICKET are scoped to the `session` identifier; clients MUST clear stored tokens when the server rotates `session` in a HELLO frame.

### Error handling
- Header validation failures (bad magic, reserved bits, length overflow) are fatal and translate to a `TransportEvent` with `reason: 'protocol-error'` followed by socket teardown.
- Payload-level decode errors (malformed CBOR, unknown mandatory fields) trigger a single `ERROR_REPORT` response when possible and then close the connection with `protocol-error`.
- HEARTBEAT timeouts map to `reconnecting` events, while CLOSE_HINT frames land as `disconnect` events with the supplied reason code.

### Validation toolkit
- Encoder/decoder implementations MUST round-trip the conformance corpus: a set of HELLO, HEARTBEAT, RESUME_TICKET, CLOSE_HINT, and ERROR_REPORT frames stored as binary fixtures plus expected decoded structures.
- Property-based tests should assert that arbitrary SSH payloads ≤1 MiB survive encode/decode without mutation and that sequence ordering is preserved.
- Fuzz targets MUST reject header corruption without panicking, especially around `length` boundaries and CBOR payload parsing.
- Diagnostics logs should include `codec.id`, `sequence`, and `flags` for every fatal error to aid cross-environment debugging.

### Interoperability notes
- The codec never mutates SSH payload bytes; servers peel the 14-byte header and feed the original RFC 4253 packets straight into their SSH stack. Implementations such as `golang.org/x/crypto/ssh` therefore interoperate without modifications.
- Mana defaults to modern OpenSSH algorithms (curve25519 KEX, ssh-ed25519 host keys, aes128-gcm cipher, umac-64 MAC). When targeting Go hosts, expose preset overrides that include `aes128-ctr`, `chacha20-poly1305@openssh.com`, and `hmac-sha2-256/512` to match the Go runtime catalogue.
- Resume ticket control frames are optional; servers that ignore them remain compliant but forego reconnect optimisations. The browser client downgrades gracefully by emitting `reconnecting` events with `resume=false`.

### Lifecycle semantics
- `state` transitions in a single direction per session lifecycle: `idle → connecting → handshaking → ready`. A reconnect attempt enters `reconnecting` before looping back to `connecting` or terminating at `failed`/`closed`.
- Every transition emits a matching `TransportEvent`. For example, `connecting` emits `connected`, `handshaking` emits `keys-established`, and teardown emits `disconnect` followed by optional `error`.
- `lastError` reflects the payload of the most recent `error` event and resets to `null` on `connect()` once the WebSocket successfully opens.
- `dispose()` hard-transitions to `closed`, cancels outstanding reconnect timers, and emits a final `disconnect` event with a synthetic summary that consumers can distinguish from remote closures.

### Event ergonomics
The async iterable on `events` remains the canonical delivery mechanism and integrates with async generators, but the `on` helper gives React hosts and imperative shells a simple subscription primitive. The unsubscribe handle must be invoked by consumers; `dispose()` cleans up any remaining subscriptions automatically.

### Default algorithm catalogue
Until wider cipher/MAC support lands in `@mana/ssh`, the client ships with the following defaults:
- `keyExchange`: `['curve25519-sha256@libssh.org', 'diffie-hellman-group14-sha256']`
- `hostKeys`: `['ssh-ed25519']`
- `ciphers`: `['aes128-gcm@openssh.com']`
- `macs`: `['umac-64@openssh.com']` (negotiated, enforced once MAC handling is implemented)
- `compression`: `['none']`

If consumers provide a partial override (for example, a custom cipher list), the supplied arrays replace only the specified suites while the remaining defaults stay intact. The transport validates the merged catalog against the capabilities exposed by `@mana/ssh` and emits an `error` event with `reason: 'protocol-error'` if an unsupported combination is requested.

## Behavioural outline

1. **Instantiation** – Consumer calls `createWebSocketSshClient(config)`; the client stores configuration, snapshots algorithm defaults, records the resolved frame codec, and remains `idle` with `lastError = null`.
2. **connect()** – Opens the WebSocket (rejecting immediately if executed from an insecure context), streams SSH identification + KEXINIT, hydrates `createClientSession`, and resolves once we emit `keys-established` and the default session channel handshake completes. Abort signals cancel the attempt and emit an `error` with `reason: 'timeout'` if the caller requested cancellation.
3. **write()** – Lazily opens the primary `session` channel (if not already open), converts strings via UTF-8, and pushes chunks into the SSH session. Writes issued before readiness queue internally and flush post-handshake; writes issued during reconnect queue until either readiness is restored or the policy exhausts.
4. **Event delivery** – Inbound SSH packets surface through `TransportEvent` emissions. Consumers can iterate the async stream or use `on()`; delivery order is FIFO for a given session. Diagnostic events never interleave with transport events but are forwarded to the optional logger hook.
5. **Failure + retry** – If the WebSocket closes unexpectedly and `reconnectPolicy.enabled` is true, we emit `reconnecting`, compute a backoff delay, and attempt to restore the session. On success the transport emits `connected` with `resume: false` (until resume semantics land) and drains any queued writes. On exhaustion we emit `error` with `reason: 'policy-exhausted'` followed by `disconnect` and transition to `failed`.

## Reconnect and resume contract
- `resume` is `false` until `@mana/ssh` supports channel/window restoration. The flag remains so hosts can wire UI affordances without breaking changes later.
- Queued writes survive reconnect attempts and flush once the transport re-enters `ready`. If the retry loop exhausts, queued writes are discarded after emitting the terminal `error`.
- `dispose()` during a reconnect cancels outstanding timers and emits `disconnect` with a `reason` that inspectors can distinguish from remote shutdown.
- When resume support lands the transport will emit an additional `TransportEvent` describing the resumed channel state; this proposal reserves `type: 'connected'` with `resume: true` for that future milestone.

## Security posture
- The client validates runtime security invariants before initiating a connection: secure context (`https:` origin) and `wss:` endpoints are mandatory unless the caller opts into an explicit development flag (to be defined separately for local testing).
- Credential material (`token`, custom headers) never persists inside the client; they are inserted into the WebSocket handshake only. Consumers are responsible for rotating bearer tokens and enforcing origin policies upstream.
- Cross-origin requests rely on standard browser CORS/WebSocket rules; the client exposes configuration hooks but does not attempt to bypass them. Documentation will reference CSP guidance for hosting pages that boot the client.
- Alternate codecs are treated as privileged: we surface `codec.id` in telemetry so policy engines can refuse unknown values. Future features such as TLS pinning or additional auth guards will extend the `diagnostics` surface with structured warnings instead of silent failures.

## Telemetry and diagnostics
The optional `diagnostics.logger` hook receives structured `TransportDiagnosticEvent`s covering retries, heartbeat results, codec negotiation, and non-terminal warnings (for example, unexpected server metadata). Implementations should treat the hook as best-effort: failures inside the logger are caught and surfaced through a `TransportDiagnosticEvent` with `level: 'error'` so hosts can detect logging loops. The transport itself emits only terminal conditions via `TransportEvent` to keep the public API deterministic.

## Open questions
- Authentication ergonomics: the config allows injecting an `auth` strategy but we still need UX helpers for password / keyboard-interactive flows and to clarify how prompts surface in `TransportEvent`s.
- Diagnostics payload scope: today we expose a level + message; we should validate whether richer structured data (for example, close codes, attempt counters, codec identifiers) belongs in the diagnostic channel or the main event stream.
- Security exceptions: the development escape hatch for non-secure origins needs its own policy controls and documentation so we do not encourage insecure production deployments.
- Custom codec lifecycle: we must spell out how version negotiation works when the client and server advertise incompatible codec IDs.

## Next steps
1. Spec the wire-level envelope shared between browser client and reference server (control vs data frames) and codify it alongside this doc, including the canonical `mana-default:1` codec contract.
2. Implement a Node-friendly harness to validate handshake/reconnect flows, including verification that `lastError`, retry exhaustion, diagnostic logging, and codec enforcement behave as documented.
3. Extend `@mana/ssh` with channel + auth intents so the `write` helper can deliver real shell bytes and so `resize` transitions from a no-op to an actual window change request.
4. Prototype the async iterable + `on()` helper inside `@mana/web` to ensure the ergonomics layer works for hosts without duplicating abstractions.
5. Publish a conformance test suite that third-party codecs can reuse to guarantee compatibility with the default transport expectations.
6. Stand up an integration harness against a minimal `golang.org/x/crypto/ssh` target to validate algorithm presets, HELLO negotiation, and reconnect behaviour with the canonical codec.
