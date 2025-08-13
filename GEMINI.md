# Gemini Code Assistant Context

This document provides essential context for the Gemini Code Assistant to ensure it can effectively understand and contribute to the `mana-ssh-web` project.

## Core Technologies

-   **TypeScript**: The entire monorepo is written in TypeScript. Strict type safety is a primary goal.
-   **Bun**: Used as the package manager, bundler, and test runner.
-   **Turbo**: Used for monorepo task orchestration.
-   **Biome**: Used for linting and formatting.
-   **Docker/Finch**: Used for creating a simulated SSH environment for development and testing.
-   **Effect**: Used for managing asynchronous operations, dependency injection, and robust error handling.

## Architectural Overview

The `mana-ssh-web` project is a TypeScript monorepo designed to enable SSH connections directly from a web browser. It is composed of several packages and applications:

-   **`packages/protocol`**: The core, transport-agnostic implementation of the SSH protocol. It handles the state machine, cryptography, and message serialization/deserialization. This is the heart of the library.
-   **`packages/web`**: A browser-specific package that consumes `protocol` and provides a high-level API for web applications. It will manage the WebSocket connection and integrate with the browser environment.
-   **`packages/websocket`**: A transport layer that will be used by `packages/web` to handle WebSocket communication.
-   **`apps/terminal-web-app`**: A demonstration web application that uses the `mana-ssh-web` library to create a functional web-based terminal. It uses `xterm.js` for the terminal UI.
-   **`apps/proxy-server`**: A necessary middleware component that bridges the browser's WebSocket connection to the standard TCP connection required by the SSH server.
-   **`apps/simulated-instance`**: A containerized SSH server (using Docker/Finch) that provides a realistic development and testing endpoint.

## Key Architectural Principles

1.  **Separation of Concerns**: The protocol implementation (`packages/protocol`) is completely decoupled from the network transport. This allows for easier testing, maintenance, and potential future use in non-browser environments (e.g., Node.js).
2.  **Immutability and Functional Programming**: The core protocol logic should favor pure functions and immutable data structures where possible. This helps manage the complexity of the SSH state machine and reduces the likelihood of bugs.
3.  **Type Safety**: Leverage TypeScript's advanced features to model the SSH protocol's complex data structures and states as accurately as possible. Avoid `any` and other type-safety escape hatches.
4.  **Extensibility**: The architecture should allow for future expansion, such as supporting different cryptographic algorithms or SSH extensions.

## Why Effect?

The choice to use the Effect library as a core technology is deliberate and central to the project's architecture. It directly supports our key principles and provides significant advantages for a complex, production-focused library like `mana-ssh-web`.

1.  **Composition over Inheritance**: Effect allows us to build complex programs by composing smaller, independent, and highly-cohesive parts. This aligns perfectly with our "Separation of Concerns" principle, enabling us to build, test, and maintain features like transport layers, cryptographic modules, and state machines in isolation before composing them into a final, robust program.
2.  **Declarative Dependency Injection**: Effect's `Context` provides a powerful, type-safe dependency injection system. This is critical for testability. Instead of mocking modules or classes, we can provide mock *implementations* of our services directly in our tests. For example, when testing the `protocol` package, we can inject a "MockTransport" service that simulates network conditions without any actual network calls, making our tests faster, more reliable, and easier to write.
3.  **Production-Grade Error Handling**: SSH is a complex protocol with numerous potential points of failure (network issues, cryptographic errors, protocol mismatches, etc.). Effect forces us to handle every possible error case at the type level. There are no `try/catch` blocks to forget or `Promise` rejections to miss. This compile-time guarantee is invaluable for building a library that needs to be reliable and secure. It moves error handling from a runtime concern to a compile-time one.
4.  **Superior Type-Safety and Inference**: Effect's deep integration with TypeScript's type system allows us to model complex, asynchronous, and potentially fallible workflows with a level of precision that is difficult to achieve with `async/await` and Promises alone. This reduces bugs and improves developer experience.
5.  **Structured Concurrency**: Effect provides powerful, built-in tools for managing concurrent operations, which will be essential for handling the bi-directional communication streams of an SSH connection. This helps prevent resource leaks and race conditions that are common in complex asynchronous applications.

While smaller libraries like `neverthrow` provide excellent Result types, they do not offer the comprehensive, integrated ecosystem for dependency management, concurrency, and resource handling that Effect does. For a project of this scope and complexity, Effect provides the robust foundation we need to build a production-ready, maintainable, and highly-testable library.

## How to Help

When assisting with this project, please adhere to the following guidelines:

-   **Follow Existing Conventions**: Match the coding style, naming conventions, and architectural patterns you see in the existing codebase.
-   **Prioritize Type Safety**: Write code that is as type-safe as possible.
-   **Write Tests**: Any new features or bug fixes should be accompanied by relevant tests.
-   **Use the Core Technologies**: Leverage the established tools (Bun, Turbo, Biome) for tasks.
-   **Embrace Effect**: This project has adopted Effect for all asynchronous operations, error handling, and dependency management. **Do not use Promises, `async/await`, or `try/catch` blocks directly.** All fallible and async logic should be wrapped in an `Effect`.
-   **Understand the Separation of Concerns**: Be mindful of the boundaries between the different packages. For example, do not introduce browser-specific APIs into the `protocol` package.

When in doubt, ask for clarification.

## Working with Bun Workspaces

This project uses Bun workspaces to manage the monorepo. When adding or removing dependencies, it's important to target the correct workspace.

**Tip:** Do not modify `package.json` files directly. Instead, use the `bun add` or `bun remove` commands with the `-w` or `--workspace` flag to specify the package you want to modify.

For example, to add a dependency to the `packages/protocol` workspace, run:

```sh
bun add <package-name> -w @mana-ssh-web/protocol
```

To add a dev dependency, use the `-d` flag:

```sh
bun add -d <package-name> -w @mana-ssh-web/protocol
```

This ensures that the dependency is added to the correct `package.json` and the `bun.lockb` file is updated correctly.