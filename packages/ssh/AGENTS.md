# @mana/ssh Agent Charter

This brief governs the SSH protocol core. Update it whenever RFC scope, security posture, or vendor expectations shift.

## Mandate
- Ship a transport-agnostic SSH engine that consumes raw octets and emits deterministic protocol intents/events.
- Track RFC 4250–4256 plus required extensions (RFC 4344, 4419, 5656, 6668, 7478, 8308, 8332, 8709, 9142, etc.) exactly; document any divergence.
- Keep the package standalone and vendable: no implicit browser, DOM, or runtime globals.

## Scope & Boundaries
- Lives entirely within `packages/ssh`; everything else integrates via typed adapters (transport, crypto, storage, telemetry).
- Randomness, monotonic clocks, and crypto primitives are injected — default wiring may use WebCrypto, but the engine never calls it directly.
- No direct socket ownership. Higher layers (`@mana/web`, `@mana/websocket`, proxy server) are responsible for IO and policy UX.

## Specification Library
- Canonical texts (RFCs, Internet-Drafts, OpenSSH protocol notes) live under `packages/ssh/context/*.txt`.
- Treat the directory as read-only source material; cite filenames + section numbers in code/comments when implementing a requirement.
- Missing or unavailable drafts (e.g., `draft-miller-ssh-curve25519-sha256-04`) are tracked as placeholders with guidance on alternate references.

## API Direction
- Expose `createClientSession(config: SshClientConfig): SshSession` as the primary entry point.
- Configuration supplies deterministic dependencies only (clock, randomness, algorithm catalog, host key policy, authentication strategy, channel limits, diagnostics).
- Session ingests byte sequences via `receive` and emits typed events (`SshEvent`)—including `outbound-data` events—without owning any transport callbacks.
- Hosts pull pending outbound packets via the event iterator or explicit flush helpers; transport wrappers live outside this package.
- State transitions remain pure; no IO, sockets, timers, or global access inside the engine.

## Interoperability Priorities
- **Tier 1**: OpenSSH (client/server) and libssh. Maintain replay fixtures, ensure RSA-SHA2, curve25519, chacha20-poly1305, and ext-info behaviors match.
- **Tier 2**: Dropbear, embedded appliances, and legacy Cisco/Juniper deployments. Support when safe (group-exchange DH, hmac-sha1) and guard with policy toggles.
- **Tier 3**: Other vendors. Provide algorithm registration hooks and document how adopters can extend without forking.

## Distribution Strategy
- Publish dual artifacts: `web` build targeting browsers/workers (ES2022, tree-shakeable, no Node globals) and `node` build optimized for Node 18+.
- Maintain identical TypeScript types for both entry points; choose implementation via `exports` map in `package.json`.
- Plan follow-on support for Bun and Deno once the core stabilizes—keep abstractions runtime-neutral so additional builds remain additive.

## Security & Compliance Pillars
- Constant-time comparisons, defensive parsing, transcript binding, and strict rekey thresholds are mandatory.
- Default algorithm catalog prefers modern suites (curve25519, Ed25519, chacha20-poly1305, AES-GCM, HMAC-SHA2). SHA-1 and legacy RSA are opt-in only.
- Host key trust flows must support TOFU, SSHFP/DNSSEC (RFC 4255), X.509 (RFC 6187), and OpenSSH KRL revocation checks.

## Testing Doctrine
- **Type & lint gates**: `bun run typecheck`, `bun run lint` required for every change.
- **Unit / property**: Vitest + fast-check over packet reducers, negotiation tables, and crypto glue.
- **Integration transcripts**: Replay captures from OpenSSH/libssh/Dropbear to assert byte-for-byte compatibility.
- **End-to-end**: Once wired into `apps/terminal-web-app`, run Playwright scenarios exercising handshake, auth, channel flows, and rekeying through the canvas renderer harness.
- **Crypto validation**: Known-answer tests for curve25519 (RFC 7748), Ed25519 (RFC 8032), ChaCha20-Poly1305 (RFC 8439).

## Roadmap Signals
1. **Phase 0** – Scaffolding: type baselines, spec matrix, deterministic RNG/time adapters.
2. **Phase 1** – Transport core: framing, algorithm negotiation, curve25519 + group14 key exchange, AES-GCM/chacha20 ciphers, rekey rules.
3. **Phase 2** – Authentication: public-key (RSA-SHA2, Ed25519, ECDSA), password, keyboard-interactive, GSS-API hooks.
4. **Phase 3** – Connection protocol: channel lifecycle, global requests, vendor channel extensions (OpenSSH `session@openssh.com`, streamlocal).
5. **Phase 4** – Host trust: known-host stores, SSHFP/DNSSEC validation, X.509, KRL ingestion.
6. **Phase 5** – Extended ecosystem: agent forwarding, port forwarding, optional SFTP module riding the channel API.

## Collaboration Rituals
1. Challenge every requirement: confirm it belongs in the protocol core versus adapters.
2. Draft strategy → secure approval → update docs/spec references → tests → implementation.
3. Land work only after unit/property suites and relevant transcripts pass; note gaps explicitly.
4. Log security decisions, vendor quirks, and roadmap updates in the memory bank with dates + spec citations.

## Memory Bank
### 2025-09-30 — Charter established
Initial mandate, design pillars, and testing cadence captured.

### 2025-10-01 — Spec catalog & interop tiers
Clarified that the core package emits outbound data as events while transport wrappers live in separate packages, keeping the engine strictly spec-focused.

Curated raw spec corpus under `context/`, agreed to focus interoperability on OpenSSH/libssh first, Dropbear second, and expose extension hooks for additional vendors. Defined client-session API direction and phased roadmap.

### 2025-10-02 — Transport phase follow-up
- ✅ Hardened AES-GCM send/receive (sequence guards, padding alignment) and replay fixtures.
- ✅ Session channel lifecycle implemented (open confirmation, data, window adjust, EOF/close) with command reducers and diagnostics.
- Next: surface channel requests (`pty-req`, `exit-status`, signals), enforce outbound flow control/rekey counters, and expand cipher catalog (ChaCha20, HMAC).
