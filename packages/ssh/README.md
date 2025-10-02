# ManaSSH Protocol

This package contains the core, transport-agnostic implementation of the SSH protocol (RFCs 4250-4254).

## Purpose

This package manages the SSH state machine, handles cryptographic operations, and performs message serialization/deserialization. It is designed to be completely independent of any network transport, taking byte arrays in and producing byte arrays out.

This strict separation of concerns allows for maximum testability, flexibility, and extensibility. It is consumed by higher-level packages (like `@mana/web`) to provide a complete client solution.

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

Run `bun run test` inside `packages/ssh` to execute the suite.
