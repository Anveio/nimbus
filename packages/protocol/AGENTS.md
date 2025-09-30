# @mana-ssh/protocol Agent Charter

This charter governs the SSH protocol core. Update it whenever RFC scope, security posture, or implementation rituals evolve.

## Mandate
- Implement SSHv2 (RFC 4250–4254, RFC 5656, extensions) as a transport-agnostic state machine that consumes bytes and produces deterministic protocol events/responses.
- Provide cryptographic primitives (key exchange, host authentication, bulk ciphers, MACs) with constant-time, side-channel mindful implementations.
- Surface strictly typed APIs that higher layers (`@mana-ssh/web`, `@mana-ssh/websocket`, proxy services) can drive without touching internal state.

## Boundaries & Dependencies
- Lives entirely within `packages/protocol`; no direct network sockets, timers, or global state. Randomness and crypto sources are injectable.
- Depends on audited crypto libraries (WebCrypto, wasm backends) through explicit adapters. Keep FIPS/AWS compliance in mind when selecting algorithms.
- Emits abstract channel events (open/close/data, requests, global alerts) that transports or hosts translate into IO. Never embed UI, React, or renderer assumptions.

## Design Pillars
- **Spec fidelity**: Encode RFC requirements verbatim; cite clauses in code comments when behaviour diverges. Extension points (e.g., curve25519, chacha20-poly1305, agent forwarding) must be opt-in overlays.
- **Deterministic state machine**: Treat all operations as pure functions over immutable session state; isolate mutability inside orchestrators to aid testing and replay.
- **Security first**: Constant-time comparisons, transcript binding, rekey thresholds, and defensive parsing are non-negotiable. Treat malformed inputs as hostile.
- **Extensibility**: Algorithm negotiation tables and packet handlers should allow additive additions without rewriting the core.
- **Telemetry hooks**: Provide structured diagnostics (handshake timings, negotiated algorithms, error codes) so hosts can log and alert without leaking secrets.

## Testing Doctrine
- Unit/property tests: Use Vitest/fast-check against packet parsers, key-exchange math, and negotiation fallbacks. Mock entropy sources for determinism.
- Integration transcripts: Reproduce known-good SSH handshakes (OpenSSH golden captures) and assert byte-for-byte parity through replay harnesses.
- Interop harness: Periodically run against real OpenSSH/Dropbear targets via the proxy server; capture divergences as specs.
- Type & lint gates: `bun run typecheck` and `bun run lint` at repo root; avoid ambient `any`.
- Spec workflow: Document protocol changes in `docs/` (e.g., KEX support matrices, message flow diagrams) before altering code/tests.

## Active Focus / Backlog Signals
- Stand up the initial handshake pipeline (banner exchange, algorithm negotiation, curve25519-sha256 key exchange, AES-GCM record layer).
- Implement channel management (session channels, window sizing, global requests) with typed events for higher layers.
- Define crypto provider abstraction so WebCrypto, Node crypto, and wasm fallbacks share the same surface.
- Model host key verification and known-host persistence hooks suitable for AWS/Amazon Linux targets.
- Plan rekey strategy (packet limits, timeouts) plus extension hooks for pubkey auth, agent forwarding, and port forwarding.

## Collaboration Rituals
1. Challenge requirements: confirm behaviour belongs in the protocol core versus transports or hosts.
2. Propose strategy → secure approval → update docs/specs → tests → implementation.
3. Run targeted unit/property suites plus any available integration transcripts before landing changes.
4. Record security decisions, interoperability findings, and roadmap moves in the memory bank with precise dates.

## Memory Bank
### 2025-09-30 – Charter established
Created the protocol agent charter outlining mandate, security pillars, testing cadence, and immediate backlog (handshake pipeline, channel management, crypto abstraction).

