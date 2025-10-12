# Specification Matrix — `@nimbus/ssh`

| Feature | Primary Spec | Supplemental Notes | Status |
| --- | --- | --- | --- |
| Identification exchange | RFC 4253 §4.2 | Validate banner length and character set | Complete |
| Algorithm negotiation | RFC 4253 §7 | Supports ext-info (RFC 8308) for RSA-SHA2 discovery | Complete |
| Key exchange — curve25519-sha256 | draft-miller-ssh-curve25519-sha256-04*, RFC 7748 | Handshake + NEWKEYS with AES-GCM key activation | In Progress |
| Key exchange — group14-sha256 | RFC 4419 | Handshake + NEWKEYS with AES-GCM key activation | In Progress |
| Cipher suites (AES-GCM, ChaCha20-Poly1305) | RFC 5647, RFC 8439 | AES128-GCM active; ChaCha20-Poly1305 pending | In Progress |
| MAC algorithms (HMAC-SHA2) | RFC 6668 | SHA-1 variants gated behind compatibility flag | Planned |
| Public-key auth | RFC 4252, RFC 7478, RFC 8332, RFC 8709 | Ed25519 default, RSA-SHA1 disabled by default | Planned |
| Keyboard-interactive auth | RFC 4256 | Multi-step prompt flow | Planned |
| Connection protocol (channels) | RFC 4254 | Session channel open/confirm, window adjust, data/EOF/close events emitted | In Progress |
| Global requests | RFC 4254 §4 | Parse keepalive/tcpip-forward and surface structured events | In Progress |
| Rekeying | RFC 4253 §9 | Packet/byte/time thresholds configurable | Planned |
| Host key verification | RFC 4255, RFC 6187, OpenSSH KRL | TOFU evaluation + Ed25519 verification wired; additional algorithms queued | In Progress |
| Agent forwarding | draft-miller-ssh-agent-02, OpenSSH PROTOCOL.agent | Feature flag | Planned |
| Port forwarding | RFC 4254, OpenSSH PROTOCOL | Direct TCP/IP and streamlocal support | Planned |
| SFTP subsystem | draft-ietf-secsh-filexfer-13 | Delivered as sibling package | Deferred |

*Draft unavailable in full; see placeholder notes in `context/draft-miller-ssh-curve25519-sha256-04.md`.

Status legend: **Planned** (covered in current roadmap), **In Progress**, **Complete**, **Deferred**.
