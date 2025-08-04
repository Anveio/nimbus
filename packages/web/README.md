# ManaSSH Web

This is the primary, user-facing package for the ManaSSHWeb library. It provides a simple, high-level API for establishing a secure SSH session over WebSockets from within a web browser.

## Purpose

This is the "batteries-included" package that 99% of users will install. It provides the main entry point for the library and is responsible for orchestrating the underlying protocol and transport layers.

## Architecture

This package consumes the following internal packages to provide its functionality:

-   `@mana-ssh/protocol`: The core, transport-agnostic SSH protocol implementation.
-   `@mana-ssh/websocket`: The WebSocket transport layer implementation.

By composing these lower-level packages, `@mana-ssh/web` can handle high-level concerns like API design, connection management (including reconnection and backpressure), and providing a seamless developer experience. This architecture ensures the core logic is highly modular, testable, and extensible for future transport layers.
