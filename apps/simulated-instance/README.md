# Simulated SSH Instance

## Purpose

This application serves as a crucial component of the ManaSSHWeb demonstration and testing environment. It is a lightweight, cross-platform SSH server built entirely in Node.js using the `ssh2` and `node-pty` libraries.

Its primary function is to simulate a real-world SSH target, allowing us to showcase a complete, end-to-end SSH connection that originates from a web browser, passes through a WebSocket proxy, and terminates in an interactive shell session.

## Role in the Architecture

The ManaSSHWeb project aims to provide a secure and modern library for web-based SSH. To demonstrate this, we use the following architecture:

`[Web App with mana-ssh-web]` <--(WebSocket)--> `[Proxy Server]` <--(TCP)--> `[This Simulated Instance]`

This simulated server fulfills the role of the final SSH endpoint. By building it in Node.js, we achieve several key advantages:

- **Portability:** It runs on any system with Node.js/Bun, requiring no system-level `sshd` configuration or Docker.
- **Isolation:** It runs as a simple, unprivileged process, ensuring it doesn't interfere with the host machine's security or configuration.
- **Interactivity:** By leveraging `node-pty`, it provides a true, interactive pseudo-terminal experience, making the demonstration feel authentic.
- **Simplicity:** It allows anyone to clone the repository and run a full, end-to-end test with a single command.

This approach ensures that developers can quickly and easily see the `mana-ssh-web` library in action without complex setup or external dependencies.

## Technical Note: Node.js Runner (`tsx`)

While the ManaSSHWeb monorepo primarily uses `bun` as its package manager and runtime, this `simulated-instance` application is specifically executed with Node.js via the `tsx` runner.

This decision was made to ensure maximum compatibility and stability. The `node-pty` library, which is critical for providing an interactive pseudo-terminal, relies on native C++ addons. These native components can have compatibility issues with the Bun runtime. Using a standard Node.js runtime for this specific package guarantees that the native modules compile and run correctly across all platforms (macOS, Linux, and Windows), providing a reliable and seamless "out-of-the-box" experience for developers testing the library.
