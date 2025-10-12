# NimbusSSH Protocol

This package contains the core, transport-agnostic implementation of the SSH protocol (RFCs 4250-4254).

## Purpose

This package manages the SSH state machine, handles cryptographic operations, and performs message serialization/deserialization. It is designed to be completely independent of any network transport, taking byte arrays in and producing byte arrays out.

This strict separation of concerns allows for maximum testability, flexibility, and extensibility. It is consumed by higher-level packages (like `@nimbus/react` and the demo apps) to provide a complete client solution.

## Runtime dependencies

The core constructor (`createClientSession`) is runtime agnostic: it has no built-in knowledge of sockets, timers, or platforms. Instead, callers must inject the environment-specific primitives (`clock`, `randomBytes`, `crypto`, host-key policy, identity, etc.) through the `SshClientConfig`. Most consumers should rely on the runtime-aware adapters that do this wiring automatically:

- `@nimbus/ssh/client/web` – browser/worker defaults
- `@nimbus/ssh/client/node` – Node 18+ defaults
- future runtimes (Deno, Bun, servers) will expose similar entry points

Importing the top-level package in environments where those dependencies are not provided will fail; pick the adapter that matches your runtime or supply the primitives explicitly. Public-key authentication requires a username and signing material—runtime adapters generate an ephemeral Ed25519 keypair by default and emit the OpenSSH-formatted public key so hosts can pass it to EC2 Instance Connect or similar services before authentication completes.

## Current Status

- ✅ RFC 4253 §4–§7 identification exchange and algorithm negotiation, including ext-info handling
- ✅ Key exchange reducers for `curve25519-sha256@libssh.org` (RFC 5656 §4.1 / RFC 7748 §5.2) and `diffie-hellman-group14-sha256` (RFC 4419 §3)
- ✅ Host key verification pipeline (Ed25519) with fingerprint evaluation hooks and NEWKEYS sequencing
- ⚙️ Follow-up: extend channel request support, enforce flow-control/rekey policies, and widen cipher/MAC coverage (ChaCha20, HMAC-SHA2)

See `packages/ssh/test` for the RFC-backed fixtures that exercise the handshake surface area.

## Test Coverage (selected)

| Test | Scenario | Primary RFCs |
| --- | --- | --- |
| `session-handshake.test.ts` | Identification + KEXINIT negotiation | RFC 4253 §4, §7 |
| `transport-negotiation.test.ts` | Preference-based algorithm selection | RFC 4253 §7 |
| `key-exchange.curve25519.test.ts` | Browser curve25519 ECDH flow, host key verification, NEWKEYS | RFC 5656 §4.1, RFC 7748 §5.2 |
| `key-exchange.group14.test.ts` | group14 Diffie-Hellman fallback and NEWKEYS | RFC 4419 §3 |

Run `npm run test` inside `packages/ssh` to execute the suite.
