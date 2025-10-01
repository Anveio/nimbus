# ManaSSH Protocol

This package contains the core, transport-agnostic implementation of the SSH protocol (RFCs 4250-4254).

## Purpose

This is the heart of the ManaSSHWeb library. It manages the SSH state machine, handles cryptographic operations, and performs message serialization/deserialization. It is designed to be completely independent of any network transport, taking byte arrays in and producing byte arrays out.

This strict separation of concerns allows for maximum testability, flexibility, and extensibility. It is consumed by higher-level packages (like `@mana-ssh/web`) to provide a complete client solution.
