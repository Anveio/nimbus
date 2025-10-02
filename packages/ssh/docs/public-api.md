# `@mana/ssh` Public API & Implementation Strategy

> Drafted: 2025-10-01

This document captures the proposed API surface, behavioural contract, and build-out plan for the `@mana/ssh` package. The goal is to deliver a spec-faithful SSHv2 engine that higher-layer transports (browser WebSockets, proxy servers, desktop apps) can consume without inheriting protocol complexity.

## Goals
- **Spec compliance first**: Implement RFC 4250–4256 and mandatory updates (RFC 4344, 4419, 5647, 5656, 6668, 7478, 8308, 8332, 8709, 9142, etc.) exactly. Document any intentional divergence.
- **Transport-agnostic**: Accept and emit byte sequences; never touch sockets, DOM APIs, or Node globals. Transport wrappers live elsewhere.
- **Deterministic state machine**: Provide a pure reducer interface so tests can replay transcripts, compare snapshots, and reason about ordering.
- **Type-sound ergonomics**: Expose discriminated unions for events/intents, branded identifiers for channels, and strongly typed configuration.
- **Security posture**: Default to modern algorithms (curve25519, Ed25519, chacha20-poly1305, AES-GCM, HMAC-SHA2) with opt-in compatibility toggles.
- **Traceability**: Emit auditable events for every significant transition (handshake, auth, channel ops, extension negotiation, disconnects).

## Top-Level Entry Point

```ts
import { createClientSession } from '@mana/ssh';

const session = createClientSession(config);
```

### `SshClientConfig`

| Field | Purpose | Notes |
| --- | --- | --- |
| `clock: () => number` | Monotonic time source (ms) | Used for rekey thresholds, keepalives (RFC 4253 §9) |
| `randomBytes: (length: number) => Uint8Array` | Cryptographically strong entropy | Required for key exchange, padding, nonce generation |
| `identification` | Client banner + optional local metadata | Must satisfy RFC 4253 §4.2 |
| `algorithms: AlgorithmCatalog` | Ordered preferences for KEX, ciphers, MACs, host keys, compression, extensions | Defaults prefer modern suites; registries validate identifiers against RFC 4250 |
| `hostKeys: HostKeyStore` | Policy for verifying server keys (TOFU, SSHFP/DNSSEC, X.509, OpenSSH KRL) | Exposes callbacks for persistence and policy prompts |
| `auth: AuthenticationStrategy` | Orchestrates RFC 4252 flows (password, public-key, keyboard-interactive, GSS) | Keeps interactive UX outside core |
| `channels?: ChannelPolicy` | Limits and feature toggles for RFC 4254 channels and vendor extras | Controls window sizing, concurrency, port forwarding enablement |
| `diagnostics?: DiagnosticsSink` | Structured logging hooks | No side-effects unless host subscribes |
| `guards?: EngineGuards` | Policy flags (e.g., `allowSha1Signatures`, `enableDropbearCompat`) | Fail closed by default |

### `SshSession`

```ts
interface SshSession {
  receive(chunk: Uint8Array): void;
  command(intent: ClientIntent): void;
  events: AsyncIterable<SshEvent>;
  nextEvent(): SshEvent | undefined;
  flushOutbound(): readonly Uint8Array[];
  inspect(): SshSessionSnapshot;
  close(reason?: DisconnectOptions): void;
  dispose(): void;
}
```

- `receive` buffers incoming bytes, validates packet structure (RFC 4253 §6), decrypts/MAC-checks if keys are active, and emits events.
- `events` / `nextEvent` expose typed transitions. Hosts may `for await` or poll depending on their scheduler.
- `flushOutbound` yields ciphertext/plaintext frames ready to transmit; internally it drains an immutable queue built by the reducer.
- `command` accepts user-driven intents (e.g., start auth, respond to prompts, open/send on channels). Commands mutate state via the same reducer path as incoming packets to keep flow deterministic.
- `inspect` returns a snapshot (negotiated algorithms, outstanding requests, open channels) for debugging or testing.

### Event Model

Each event is a discriminated union tagged with a `type` string. Inline docs cite the governing spec clause.

```ts
type SshEvent =
  | { type: 'identification-received'; serverId: string; raw: string }
  | { type: 'kex-init-sent'; client: NegotiationSummary }
  | { type: 'kex-init-received'; server: NegotiationSummary }
  | { type: 'keys-established'; algorithms: NegotiatedAlgorithms }
  | { type: 'outbound-data'; payload: Uint8Array; encryption: CipherStateLabel }
  | { type: 'auth-prompt'; method: 'keyboard-interactive'; prompts: AuthPrompt[] }
  | { type: 'auth-success' }
  | { type: 'auth-failure'; methodsLeft: string[]; partial: boolean }
  | { type: 'channel-open'; channel: ChannelDescriptor }
  | { type: 'channel-data'; channelId: ChannelId; data: Uint8Array }
  | { type: 'channel-eof'; channelId: ChannelId }
  | { type: 'channel-window-adjust'; channelId: ChannelId; delta: number }
  | { type: 'channel-close'; channelId: ChannelId; exitStatus?: number }
  | { type: 'global-request'; request: GlobalRequestPayload }
  | { type: 'disconnect'; summary: DisconnectSummary }
  | { type: 'warning'; code: string; message: string; detail?: unknown };
```

Notable design choices:
- `outbound-data` events carry encrypted payloads that transports must send unmodified. Hosts can flush them immediately or batch.
- Channel-related events lift numeric IDs into branded types to prevent accidental cross-channel mixing.
- `warning` covers recoverable anomalies (e.g., ignored extension, vendor quirk) so hosts can log without treating them as fatal.

### Intent Model

```ts
type ClientIntent =
  | { type: 'start-auth'; username: string; service?: string }
  | { type: 'provide-password'; password: string }
  | { type: 'offer-public-key'; keyId: string; signature?: Uint8Array }
  | { type: 'respond-keyboard-interactive'; responses: string[] }
  | { type: 'open-channel'; request: ChannelOpenRequest }
  | { type: 'send-channel-data'; channelId: ChannelId; data: Uint8Array }
  | { type: 'adjust-window'; channelId: ChannelId; delta: number }
  | { type: 'request-global'; payload: GlobalRequest }
  | { type: 'signal-channel'; channelId: ChannelId; signal: string }
  | { type: 'close-channel'; channelId: ChannelId }
  | { type: 'disconnect'; reason?: DisconnectOptions };
```

Commands that produce outbound packets enqueue them, generating matching `outbound-data` events. Invalid intents (e.g., sending data on a closed channel) raise typed errors and produce diagnostics.

## Edge Cases & Guarantees
- **Partial packets**: The reducer accumulates data until a full SSH packet is available. Malformed lengths trigger immediate disconnect events per RFC 4253 §12.
- **MAC failures**: Emit `warning` + `disconnect` with reason `mac-error`. The engine clears keys and stops accepting further input to prevent downgrade attacks.
- **Rekeying**: Automatically triggers when packet or byte counters exceed negotiated thresholds (RFC 4253 §9). Hosts observe `kex-init-sent` / `kex-init-received` events during rekey.
- **Ext-info negotiation**: Recognises `ext-info-c`/`ext-info-s` and emits events when extensions (e.g., `server-sig-algs`) adjust signature policy.
- **Channel flow control**: Honours initial window sizes; refuses to send `channel data` intents that exceed available window, returning an error and optional `warning` event.
- **Vendor quirks**: Dropbear compatibility (e.g., `SSH_MSG_USERAUTH_BANNER` sequencing) is gated behind explicit guards and flagged in diagnostics when enabled.

## Alternatives Considered

| Approach | Rationale for Rejection |
| --- | --- |
| **Embedding transport callbacks (`onSend`) inside config** | Couples the engine to host IO, complicates deterministic testing, and makes buffering behaviour opaque. By switching to `outbound-data` events, transports remain thin wrappers. |
| **Promise-based command API** | Returning promises for each intent hides sequencing rules (SSH is strictly ordered). The reducer approach keeps ordering explicit and avoids interleaving problems in concurrent runtimes. |
| **EventEmitter style** | Node-centric emitter APIs introduce memory-leak hazards and don’t compose well with async iterators used in browser workers. Async iterable events work natively with `for await` and adapters can still expose emitter facades. |
| **Merging client & server APIs early** | Server mode requires additional guards (host key management, multi-channel concurrency, authentication policy). Keeping the initial surface client-only reduces scope and lets us harden the reducer before generalising. |
| **Directly adopting existing JS SSH APIs (e.g., `ssh2` streams)** | Those libraries prioritise Node streams; adapting them to the browser introduces polyfill debt and loses determinism. Building our own reducer affords full control over WebCrypto usage, spec coverage, and event semantics aligned with the terminal renderer. |

## Prior Art & Influence

- **Go `golang.org/x/crypto/ssh`**: Provides inspiration for typed clients, algorithm negotiation tables, and channel abstractions. We emulate its separation between `ClientConfig` and per-connection `Client` while adapting to async iterables instead of Go channels.
- **libssh / libssh2 (C)**: Demonstrate the value of context structs and callback-free APIs for embedded environments. Our reducer mirrors their event loop integration but offers TypeScript typing and immutable snapshots.
- **Rust `thrussh` / `russh`**: Showcase futures-based state machines and strongly typed events. We borrow their approach to representing channel IDs and auth flows as enums.
- **OpenSSH**: Source of vendor extensions and real-world packet traces. We align algorithm names, extension negotiation, and KEX ordering with OpenSSH behaviour to ensure interoperability.
- **Node `ssh2`**: Reinforces the importance of API ergonomics for channels and forwarding; however, the stream/eventemitter style is less suitable for browsers, underscoring our async-iterator design.

## Implementation Strategy

1. **Phase 0 — Foundations**
   - Set up TypeScript project references, strict compiler settings, and lint rules.
   - Build shared primitives: `ByteReader`, `PacketBuilder`, branded IDs, error classes.
   - Author `docs/spec-matrix.md` mapping RFC clauses to modules and tests.

2. **Phase 1 — Transport Layer**
   - Implement identification exchange, KEXINIT negotiation, packet framing, encryption, MACs, compression hooks.
   - Support `curve25519-sha256@libssh.org`, `diffie-hellman-group14-sha256`, `aes128-gcm@openssh.com`, `chacha20-poly1305@openssh.com`, `hmac-sha2-256`.
   - Emit `outbound-data`, `kex-*`, and `warning` events for negotiation results.
   - Tests: property checks for packet (de)serialization, replay of OpenSSH handshake traces, known-answer tests for crypto.

3. **Phase 2 — Authentication**
   - Implement service requests, auth method negotiation, public-key, password, and keyboard-interactive flows.
   - Add hooks for GSS-API (RFC 4462) as optional modules.
   - Tests: fixtures for success/failure scenarios, partial success handling, banner events, ext-info `server-sig-algs` negotiation.

4. **Phase 3 — Connection Protocol**
   - Channel open/confirm/failure, data, EOF, close, window adjustments, and channel requests (pty-req, exec, subsystem).
   - Global requests: `tcpip-forward`, `keepalive@openssh.com`, `no-more-sessions@openssh.com`.
   - Include vendor channel extensions behind guard flags.
   - Tests: deterministic channel lifecycle transcripts, stress tests for window management, fuzz tests for malformed requests.

5. **Phase 4 — Rekey & Session Maintenance**
   - Automatic rekey triggers (packets/bytes/time), key rotation, error handling when rekey fails.
   - Diagnostics for rekey schedule, warnings for hosts that refuse to rekey.

6. **Phase 5 — Host Trust & Persistence**
   - Implement TOFU cache, SSHFP/DNSSEC validation hooks, X.509 parsing (RFC 6187), OpenSSH KRL support.
   - Tests: simulate known-host updates, revocation checks, failure modes.

7. **Phase 6 — Extended Capabilities**
   - Agent forwarding protocol (draft-miller-ssh-agent-02), port forwarding helpers, optional SFTP module layered on channels.
   - Provide separate transport wrappers (`@mana/websocket`, `@mana/node-stream`) leveraging the event/intent API.

## Distribution Plan Recap
- Dual outputs: `web` (ES2022, WebCrypto-ready, tree-shakeable) and `node` (Node 18+, uses `crypto` module). Shared TypeScript declarations.
- Future: dedicated Bun and Deno builds once runtime differences become clearer; ensure abstractions stay runtime-neutral to keep additional artifacts lightweight.

## Open Questions
1. Should we expose experimental server-mode APIs early for integration testing, or defer entirely until client parity is achieved?
2. Do we bundle default crypto implementations (WebCrypto, WASM) or require hosts to bring them? Current leaning: provide optional adapters to avoid bundle bloat.
3. How aggressively do we guard legacy algorithms (e.g., `hmac-sha1`)? Possibly ship them off-by-default with feature flags and runtime warnings.
4. What telemetry schema should diagnostics follow to integrate cleanly with AWS CloudWatch/OpenTelemetry conventions?

Addressing these questions will shape future revisions of this document.
