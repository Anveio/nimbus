# Project Brief: ManaSSHWeb

<project-brief>
## Technical Plan

This document outlines the technical foundation for the ManaSSHWeb project. Our goal is to build a high-performance, secure, and modern SSH client library for the web.

### Core Technologies

- **Package Manager:** Bun will be used for dependency management and as a script runner.
- **Build System:** Vite will serve as our primary build and development server, offering a fast and modern development experience.
- **Test Runner:** Vitest, the Vite-native test framework, will be used for all unit and integration tests.
- **Linter:** ESLint will be employed for its high-performance linting capabilities to ensure code quality and consistency.
- **Monorepo Management:** Turborepo will be used to manage the monorepo structure, simplifying dependency management and build processes across packages.

### Monorepo Structure

The project is organized as a monorepo with a layered internal architecture to promote separation of concerns, testability, and extensibility. The core library is split into three packages:

-   `packages/protocol`: The heart of the library. This is a pure, transport-agnostic implementation of the SSH protocol (RFCs 4250-4254). It handles the state machine, cryptography, and message serialization. It has zero knowledge of the transport layer it runs on.
-   `packages/websocket`: A lean, reusable transport layer implementation. It wraps the browser's native `WebSocket` API and exposes a standardized interface for sending and receiving data.
-   `packages/web`: The primary, public-facing package that most users will consume. It provides a simple, high-level API by composing the `protocol` and `websocket` packages. It is responsible for high-level concerns like connection management, reconnection logic, and providing a seamless developer experience.

</project-brief>

<technical-details>
## Project Configuration, Tooling, and Structure

### 1. Root-Level Configuration

- **`package.json`**: Configured as the monorepo root with `"private": true` and a `workspaces` property pointing to `"packages/*"` and `"apps/*"`. It contains `devDependencies` for global tools like `typescript` and `turbo`.
- **`turbo.json`**: Defines the dependency graph and task pipelines for the monorepo.
- **`tsconfig.base.json`**: A base TypeScript configuration that all packages in the monorepo will extend, enforcing strict type-checking and modern module resolution.

### 2. Core Package Structure (`packages/*`)

- **`@mana-ssh/protocol`**:
  - **Purpose**: The transport-agnostic core SSH protocol logic.
  - **Configuration**: A simple package with no external dependencies. It is a dependency of `@mana-ssh/web`.

- **`@mana-ssh/websocket`**:
  - **Purpose**: A lean wrapper around the browser's `WebSocket` API.
  - **Configuration**: A simple package with no external dependencies. It is a dependency of `@mana-ssh/web`.

- **`@mana-ssh/web`**:
  - **Purpose**: The main, public-facing package that bundles the protocol and transport layers into a single, easy-to-use API.
  - **Configuration**: Its `package.json` declares workspace dependencies on `@mana-ssh/protocol` and `@mana-ssh/websocket`. It defines the primary `main`, `module`, and `types` entry points for the published NPM package. Its `vite.config.ts` is configured to generate the final bundled output and TypeScript declaration files (`.d.ts`).

### 3. `@mana-ssh/protocol` Implementation Details

The core protocol package is implemented as a state machine that processes a raw byte stream.

-   **`SshProtocol` Class**: The main class that manages the connection state.
    -   **State Management**: Uses a `state` property (`pre-identification`, `kex-init-sent`, etc.) to track the handshake progress.
    -   **Buffering**: Maintains an internal `Uint8Array` buffer to accumulate incoming data from the transport.
-   **Handshake Logic**:
    -   **Identification Exchange**: The `handleData` method first parses the server's identification string (`SSH-2.0-...`). Upon success, it transitions state and triggers the sending of the client's `KEXINIT`.
    -   **Packet Deframing**: Once the identification is exchanged, the `_processPacketBuffer` method reads the first 4 bytes of the buffer to determine the packet length, waits for the full packet to arrive, and then slices it for processing.
    -   **KEXINIT Handling**:
        -   A `_createKexinitPayload` method constructs the client's key exchange message using a preferred list of modern, secure algorithms defined in `src/algorithms.ts`.
        -   When the server's `KEXINIT` message is received, `_parseKexinitPayload` uses a custom `SshDataView` utility to read the name-lists.
        -   `_negotiateAlgorithms` compares the client and server lists to select the commonly supported algorithm for each category.
-   **Utilities**:
    -   **`SshDataView`**: A utility class that extends `DataView` to simplify reading and writing SSH-specific data types (like length-prefixed strings) from/to an `ArrayBuffer`.

</technical-details>

<memory-bank>
## Project Status (2025-08-04)

### Accomplishments

We have completed a major architectural refactor of the `apps/simulated-instance` package to enhance development fidelity and align with enterprise licensing requirements. The environment is now based on a containerized Amazon Linux 2023 instance, with first-class support for **Finch**, the open-source container engine from AWS.

1.  **Finch Integration**:
    *   **Goal**: To use Finch as the primary, recommended container runtime, avoiding Docker Desktop licensing constraints.
    *   **Orchestrator Updated**: The `index.ts` script was refactored to be runtime-agnostic. It now automatically detects the correct container daemon socket, prioritizing `~/.finch/finch.sock` if it exists, and falling back to `/var/run/docker.sock`. This ensures a seamless experience for users of both Finch and Docker Desktop.
    *   **Documentation Overhauled**: The `README.md` for the package was rewritten to position Finch as the primary tool, with detailed installation instructions. Docker Desktop is now presented as a supported alternative.

2.  **Containerization of the Simulated Instance**:
    *   **`Dockerfile` Created**: A `Dockerfile` builds a genuine AL2023 environment with a configured OpenSSH server.
    *   **Dependencies Updated**: The package now uses `dockerode` to programmatically control the container runtime.
    *   **Automated Workflow**: The `dev` script automatically builds the image, starts the container, and provides graceful cleanup on exit.

### Next Steps: The Plan Forward

With the new Finch-based simulated instance complete, the backend and demonstration environment is now significantly more robust and aligned with your goals. The next step is to return to the original plan of implementing the frontend.

1.  **Implement the Terminal Web App (`apps/terminal-web-app`):**
    *   **Location:** `apps/terminal-web-app/src/main.ts`.
    *   **Technology:** TypeScript, Vite, `xterm.js`, and our `@mana-ssh/web` library.
    *   **Functionality:**
        *   Initialize an `xterm.js` instance and attach it to the DOM.
        *   Import and use the `@mana-ssh/web` library to connect to the proxy server at `ws://localhost:8080`.
        *   Establish a two-way data flow between `xterm.js` and the SSH connection.
        *   The goal is a fully interactive terminal in the browser, communicating with our new AL2023 container.

---
*Previous entries below this line.*

## Project Status (2025-08-03)

### Accomplishments

1.  **Core Architecture Refinement:** We have established a robust, three-package layered architecture for the core library to ensure separation of concerns, testability, and extensibility.
    *   **`@mana-ssh/protocol`**: A pure, transport-agnostic implementation of the SSH protocol.
    *   **`@mana-ssh/websocket`**: A lean, reusable transport layer for WebSockets.
    *   **`@mana-ssh/web`**: The main, user-facing library that composes the other two packages to provide a simple, high-level API.
    *   This structure was codified by creating the respective package directories, `package.json` files, and `README.md` files.

2.  **Demonstration Environment Setup:** We have built a complete, end-to-end demonstration environment consisting of three applications:
    *   **`apps/simulated-instance`**: A fully functional, interactive SSH server built with Node.js, `ssh2`, and `node-pty`. It runs on `localhost:2222`. We resolved a critical `node-pty` native module incompatibility by using `tsx` to run this component with the Node.js runtime instead of Bun.
    *   **`apps/proxy-server`**: A WebSocket-to-TCP proxy server that bridges communication between the web client and the simulated SSH server. It listens on `localhost:8080`.
    *   **`apps/terminal-web-app`**: A placeholder for the frontend application that will use the `@mana-ssh/web` library and `xterm.js`.

### Next Steps: The Plan Forward

With the foundational architecture and the backend demonstration environment now complete and documented, the next and final step is to implement the client-side logic.

1.  **Implement the Terminal Web App (`apps/terminal-web-app`):**
    *   **Location:** `apps/terminal-web-app/src/main.ts`.
    *   **Technology:** TypeScript, Vite, `xterm.js`, and our newly architected `@mana-ssh/web` library.
    *   **Functionality:**
        *   Initialize an `xterm.js` instance and attach it to the DOM.
        *   Import and use the `@mana-ssh/web` library to connect to the proxy server at `ws://localhost:8080`.
        *   Establish a two-way data flow:
            *   Pipe data from the SSH connection (via the library) into the `xterm.js` terminal.
            *   Pipe user input from `xterm.js` (keystrokes) into the SSH connection via the library.
        *   The goal is to have a fully interactive terminal in the browser, communicating with our simulated SSH server.
</memory-bank>

# Your user

Your user is Shovon Hasan (alias @shovonh), an L5 engineer working at AWS on the EC2 Instance Connect product. My aim is to get promoted by finding ways to make EC2 Instance Connect the best SSH + terminal interface on earth and I aim to do this by upholding AWS' strict security standards while simultaneously finding ways to improve the UX through sub millisecond response times, and supporting the latest in SSH spec extensions.
