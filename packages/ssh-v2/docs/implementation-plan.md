# `mana-ssh/ssh-v2` Implementation Plan

> Drafted: 2025-10-01

This plan sequences the work required to ship the SSHv2 protocol core as described in `public-api.md`. Each phase enumerates deliverables, references, and test obligations. Tasks are ordered to bring the reducer online incrementally while maintaining spec fidelity.

## Phase 0 — Project Foundations
- **Scaffold package build**
  - Configure `tsconfig.json` with strict mode, `composite` for build caching, and path exports for `web`/`node` entry points.
  - Establish lint and formatting via Biome; ensure `bun run typecheck` and `bun run lint` succeed with empty stubs.
- **Common utilities**
  - Implement `BinaryReader`/`BinaryWriter` helpers for SSH packet structures (RFC 4253 §5, §6).
  - Define branded types (`ChannelId`, `RequestId`, `KexRound`, etc.) to enforce intent/event safety.
  - Introduce shared error classes with spec references (e.g., `SshProtocolError`, `SshPolicyError`).
- **Test harness**
  - Set up Vitest config with deterministic RNG/clock adapters.
  - Seed fixture loader for corpus stored in `context/` (e.g., RFC samples, OpenSSH traces).

## Phase 1 — Session Skeleton & Event Pump
- Implement `SshClientConfig`, `SshSession` interfaces, and reducer scaffolding with placeholder handlers.
- Wire `receive`, `command`, `events`, `nextEvent`, `flushOutbound`, `inspect`, `close`, `dispose` methods with no-op reducers so integration tests can compile.
- Create event and intent discriminated unions with exhaustive type guards; include RFC citations in JSDoc.
- Tests: type-level assertions (tsd/vitest) ensuring `command` rejects malformed intents; snapshot tests verifying event queue behaviour for noop stubs.

## Phase 2 — Identification & Algorithm Negotiation (RFC 4253 §4–§7)
- Parse client/server identification strings; emit `identification-*` events; validate length/character constraints.
- Implement `SSH_MSG_KEXINIT` encoding/decoding, algorithm negotiation per preferences.
- Introduce algorithm catalog registry with validation against RFC 4250 naming rules; ship default ordering (curve25519, aes-gcm, chacha20, hmac-sha2, none compression).
- Tests: replay handshake transcripts from OpenSSH/libssh; property tests for negotiation (commutative preference resolution, tie-breaking).

## Phase 3 — Key Exchange & Cipher Activation
- Implement curve25519-sha256@libssh.org and diffie-hellman-group14-sha256 key exchange flows.
- Hook in AEAD (aes128-gcm@openssh.com, chacha20-poly1305@openssh.com) and MAC-based cipher suites with deterministic IV/key derivation.
- Emit `kex-init-*`, `keys-established`, and `outbound-data` events when new cipher state activates.
- Introduce rekey counters (packets, bytes) initialized but not yet enforced.
- Crypto dependencies: abstract over WebCrypto + Node `crypto` adapters; provide synchronous fallback for tests via deterministic mocks.
- Tests: known-answer tests using RFC 7748/8032 vectors; cross-check against captured OpenSSH packets.

## Phase 4 — Authentication (RFC 4252, RFC 4256, RFC 7478, RFC 8709)
- Implement service request handshake and method negotiation with partial-success semantics.
- Public-key auth: support RSA-SHA2 (RFC 8332), Ed25519/Ed448 (RFC 8709/8032), ECDSA (RFC 5656). Provide helper for signing challenge data via injected key providers.
- Password auth: basic flow with optional change request handling.
- Keyboard-interactive: manage prompt/response loop, multi-step sequences.
- `AuthenticationStrategy` interface orchestrates credentials, returning intents; default strategy handles basic combos.
- Emit `auth-prompt`, `auth-banner`, `auth-success`, `auth-failure` events.
- Tests: replay successful and failing flows from OpenSSH/Dropbear; ensure ext-info `server-sig-algs` updates signature policy mid-handshake.

## Phase 5 — Connection Protocol (RFC 4254)
- Implement channel lifecycle (open, confirmation, failure) and maintain internal channel map with window counts.
- Support channel requests: `pty-req`, `shell`, `exec`, `subsystem`, `env`, `window-change`, `signal`, `exit-status`.
- Global requests: `tcpip-forward`, `cancel-tcpip-forward`, `keepalive@openssh.com`, `no-more-sessions@openssh.com`.
- Enforce flow control: throttle `send-channel-data` intents when window exhausted; emit `warning` events when host misbehaves.
- Tests: synthetic transcripts covering session shell, exec commands, SFTP subsystem handshake, forwarding scenarios. Property tests for window maths.

## Phase 6 — Rekeying & Session Maintenance (RFC 4253 §9)
- Enforce packet/byte/time thresholds triggering automatic rekey. Ensure ongoing channels pause/resume correctly during rekey.
- Handle rekey failures gracefully (emit warning, disconnect). Provide policy knobs for stricter/looser limits.
- Implement `flushOutbound` semantics ensuring rekey packets emit promptly.
- Tests: simulate long-running sessions; assert counters reset post-rekey; fuzz erroneous rekey messages.

## Phase 7 — Host Key Trust & Policy (RFC 4255, RFC 6187, OpenSSH KRL)
- Build `HostKeyStore` with TOFU cache, DNSSEC SSHFP validation hook, optional X.509 validation.
- Parse and enforce OpenSSH KRL revocation sets.
- Expose policy decisions via diagnostics and structured results (e.g., `host-key-update-required`).
- Tests: golden fixtures for known-host updates, revoked keys, DNSSEC failure cases.

## Phase 8 — Diagnostics & Observability
- Implement `DiagnosticsSink` interface, emitting structured records (timestamp, event type, spec reference, severity).
- Provide default no-op sink; ship optional adapters for console logging and OpenTelemetry spans.
- Ensure every warning/error path references the spec clause.
- Tests: ensure sinks receive accurate metadata; verify no secrets leak (e.g., redacted passwords).

## Phase 9 — Extended Capabilities
- Agent forwarding (`draft-miller-ssh-agent-02`), control master/multiplexing (OpenSSH PROTOCOL.mux) as optional modules behind feature flags.
- Port forwarding helpers packaged separately but built atop channel APIs.
- SFTP (draft-ietf-secsh-filexfer-13) integration as sibling package using the same session events.
- Tests: integration harness with mock agent/server; file transfer unit tests; scenario coverage in `apps/terminal-web-app` once integration begins.

## Cross-Cutting Tasks
- **Documentation**: maintain `docs/spec-matrix.md`, API reference, and compatibility notes after each phase.
- **Interop Harness**: build regression harness to replay recorded SSH captures (OpenSSH, libssh, Dropbear) against the reducer; add new traces as we expand algorithm coverage.
- **Security Review**: run constant-time analysis (eslint-plugin-security, manual review), confirm zero dynamic eval, ensure dependency audits.
- **Distribution**: configure `package.json` exports for `web`/`node`, produce rollup/bundle builds, add test ensuring tree-shakeable modules.

## Acceptance Criteria for MVP
1. Establishes interactive shell session against OpenSSH server through proxy using WebSocket transport wrapper (implemented outside core).
2. Passes negotiation/auth/channel unit tests with coverage for supported algorithms.
3. Provides deterministic event log enabling snapshot testing of VT renderer integration.
4. Default policy rejects SHA-1 signatures and warns when compatibility flags enable them.

## Deferred Items
- Server-mode session factory (`createServerSession`) pending client stabilisation.
- GSS-API mechanisms beyond scaffolding (Kerberos requires additional dependencies).
- Full SFTP subsystem implementation (initial release will focus on terminal use case).
- Hardware-backed authentication (FIDO/U2F) integration, tracked separately with WebAuthn dependencies.

