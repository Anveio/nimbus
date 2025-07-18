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

The project will be organized as a monorepo to facilitate code sharing and modular development. The core components will be split into the following packages within the `packages` directory:

- `packages/mana-ssh-websocket`: This package will contain the low-level implementation of the WebSocket transport layer. It will be responsible for establishing and maintaining the WebSocket connection and handling raw data transmission.
- `packages/mana-ssh-protocol`: This package will house the browser-specific implementation of the SSH protocol (transport, authentication, and connection layers). It will consume the WebSocket transport layer and handle the intricacies of the SSH handshake, encryption, and channel management.
- `packages/mana-ssh-web`: This is the main, publicly exported library. It will aggregate the functionality from the protocol and transport layers, providing a clean, high-level API for developers to integrate into their web applications.

</project-brief>

<technical-details>
## Project Configuration, Tooling, and Structure

### 1. Root-Level Configuration

- **`package.json`**: Configured as the monorepo root with `"private": true` and a `workspaces` property pointing to `"packages/*"`. It will contain `devDependencies` for global tools like `typescript`, `turbo`, and `oxlint`. Scripts for `dev`, `build`, `test`, and `lint` will be defined to run via `turbo`.
- **`turbo.json`**: Defines the dependency graph and task pipelines for the monorepo. The `build` pipeline will be configured to depend on the `build` output of internal package dependencies (`dependsOn: ["^build"]`) and cache outputs from `dist/**` and `tsconfig.tsbuildinfo` directories.
- **`tsconfig.base.json`**: A base TypeScript configuration that all packages in the monorepo will extend. It will enforce strict type-checking rules (`strict: true`) and configure modern module resolution (`moduleResolution: "NodeNext"`) and target (`target: "ES2022"`) to ensure code quality and compatibility.

### 2. Package Structure & Configuration

Each package within `packages/*` will be a self-contained NPM package with its own `package.json`, `vite.config.ts`, and `tsconfig.json`.

- **`packages/mana-ssh-websocket`**:

  - **Purpose**: Provides a foundational, event-driven wrapper around the browser's `WebSocket` API.
  - **Configuration**: Its `vite.config.ts` will be set to library mode to produce a standalone, distributable module. It will have no external production dependencies.

- **`packages/mana-ssh-protocol`**:
  - **Purpose**: Implements the core SSH2 protocol logic, handling cryptographic operations via the `WebCrypto` API.
  - **Configuration**: Its `package.json` will declare a workspace dependency on `mana-ssh-websocket`. `vite.config.ts` will be configured for library mode.

- **`packages/mana-ssh-web`**:
  - **Purpose**: The public-facing package that bundles the protocol and transport layers into a single, easy-to-use API.
  - **Configuration**: Its `package.json` will declare a workspace dependency on `mana-ssh-protocol`. It will define the primary `main`, `module`, and `types` entry points for the published NPM package. `vite.config.ts` will be configured to generate the final bundled output and TypeScript declaration files (`.d.ts`).

### 3. SSH Specification Adherence

When executing any task, it is crucial to reference all relevant SSH-related RFCs and other official specifications. This ensures that the implementation is compliant, secure, and interoperable. Key specifications include, but are not limited to:

- [RFC 4250](https://datatracker.ietf.org/doc/html/rfc4250): The Secure Shell (SSH) Protocol Assigned Numbers
- [RFC 4251](https://datatracker.ietf.org/doc/html/rfc4251): The Secure Shell (SSH) Architecture
- [RFC 4252](https://datatracker.ietf.org/doc/html/rfc4252): The Secure Shell (SSH) Authentication Protocol
- [RFC 4253](https://datatracker.ietf.org/doc/html/rfc4253): The Secure Shell (SSH) Transport Layer Protocol
- [RFC 4254](https://datatracker.ietf.org/doc/html/rfc4254): The Secure Shell (SSH) Connection Protocol
- [RFC 4255](https://datatracker.ietf.org/doc/html/rfc4255): Using DNS to Securely Publish Secure Shell (SSH) Key Fingerprints
- [RFC 4256](https://datatracker.ietf.org/doc/html/rfc4256): Generic Message Exchange Authentication for the Secure Shell Protocol (SSH)
- [RFC 4716](https://datatracker.ietf.org/doc/html/rfc4716): The Secure Shell (SSH) Public Key File Format
- [RFC 5656](https://datatracker.ietf.org/doc/html/rfc5656): Elliptic Curve Algorithm Integration in the Secure Shell Transport Layer
- [OpenSSH Protocol Overview](https://www.openssh.com/protocol.html)

</technical-details>

<memory-bank>
</memory-bank>

# Your user

Your user is Shovon Hasan (alias @shovonh), an L5 engineer working at AWS on the EC2 Instance Connect product. My aim is to get promoted by finding ways to make EC2 Instance Connect the best SSH + terminal interface on earth and I aim to do this by upholding AWS' strict security standards while simultaneously finding ways to improve the UX through sub millisecond response times, and supporting the latest in SSH spec extensions.
