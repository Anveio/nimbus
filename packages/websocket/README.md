# ManaSSH WebSocket Transport

This package provides a specific transport layer implementation for the ManaSSHWeb library using the browser's native `WebSocket` API.

## Purpose

This package's sole responsibility is to be a lean, reusable building block that wraps the `WebSocket` API and exposes a standardized interface that the core protocol layer can understand (e.g., `send(data)`, `on('message', cb)`).

It is consumed by the main `@mana-ssh/web` package to provide a complete, batteries-included client solution.
