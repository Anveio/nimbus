# @mana-ssh/web Public API

**Audience**: This document is intended for language models to understand the design, rationale, and usage of the `@mana-ssh/web` library's public API.

## 1. Core Principles

The API is designed around the following core principles to ensure it is robust, ergonomic, and easy to use for its primary use case: a browser-based terminal.

-   **Functional and Immutable**: The API is exposed as a set of functions operating on immutable handles (`Session`). This avoids class instances and the complexities of `this` context.
-   **Explicit, First-Class Error Handling**: Functions that can fail return a `Promise` that rejects with a specific, typed `Error` subclass. This makes error handling mandatory and allows for robust recovery logic based on the error's type.
-   **Familiar Event-Driven Interface**: For an active session, all communication and lifecycle events are handled through simple `on(event, callback)` methods, a pattern familiar to all JavaScript developers.
-   **Automatic Lifecycle Management**: All event listener subscriptions are managed automatically by the library. When a session ends (due to error, disconnect, or server closure), all listeners are cleared, preventing memory leaks and simplifying consumer code.
-   **Browser-First Design**: The API is tailored for the browser, assuming a UTF-8 environment and providing data in `Uint8Array` format, which is ideal for consumption by terminal emulators like `xterm.js`.

## 2. Public API Reference

### Primary Functions

**`startSshSession(config: SshConfig): Promise<Session>`**

This is the single entry point to the library. It handles connection, authentication, and shell channel setup in one atomic operation.

-   **Returns**: A `Promise` that resolves with a `Session` object on success.
-   **Throws**: Rejects with a specific error (`ConnectionError`, `AuthError`, or `HostKeyError`) if the session cannot be established.

**`disconnect(session: Session): Promise<void>`**

Gracefully closes the session and the underlying connection. This should be called when the session is no longer needed to free up resources.

### The `Session` Interface

This is the handle to an active, interactive SSH session.

```typescript
export interface Session {
  /**
   * Sends data to the shell's input (e.g., user keystrokes).
   * @param data The string (encoded as UTF-8) or byte array to write.
   * @throws {ChannelError} if the session is not active.
   */
  write(data: string | Uint8Array): Promise<void>;

  /**
   * Informs the server that the terminal window has been resized.
   * @throws {ChannelError} if the session is not active.
   */
  resize(dimensions: { rows: number; cols: number }): Promise<void>;

  /**
   * Registers a callback to handle incoming data from the shell.
   * The listener is automatically removed when the session exits.
   */
  onData(callback: (data: Uint8Array) => void): void;

  /**
   * Registers a callback for fatal, unrecoverable errors that occur
   * during an active session.
   */
  onError(callback: (error: SshError) => void): void;

  /**
   * Registers a callback for when the session has been completely closed.
   */
  onExit(callback: (reason: ExitReason) => void): void;

  /**
   * Gracefully closes the session and the underlying connection.
   */
  disconnect(): Promise<void>;
}
```

### Configuration and Error Types

```typescript
/**
 * Configuration for starting an SSH session.
 */
export interface SshConfig {
  readonly url: string;
  readonly username: string;
  readonly secret: string; // Plain string for password or private key
  readonly hostKeyVerifier: (hostKey: PublicKey) => Promise<boolean>;
  readonly keepAliveInterval?: number;
  readonly pty?: {
    readonly term: string;
    readonly rows: number;
    readonly cols: number;
  };
}

/**
 * Base class for all errors thrown by the library.
 */
export class SshError extends Error {
  readonly _tag: string;
}

export class ConnectionError extends SshError {
  readonly reason: "WebSocketFailed" | "Timeout" | "Disconnect";
  readonly cause?: unknown;
}

export class AuthError extends SshError {
  readonly reason: "InvalidCredentials" | "PublicKeyRejected" | "NoAuthMethodsSupported";
}

// ... other specific error types (HostKeyError, ChannelError)

export interface ExitReason {
  readonly code: number;
  readonly reason: string;
  readonly by: 'client' | 'server' | 'error';
}
```

## 3. Design Rationale

-   **Why Promises that Throw vs. a Result Type?**: The initial design considered a `SshResult<{ok, value} | {ok, error}>` type. This was revised to the current `Promise<Session>` that throws on error. This pattern is more conventional in the broader JavaScript/TypeScript ecosystem and integrates more naturally with `async/await` and `try...catch...finally` blocks, leading to better developer ergonomics for the target audience.
-   **Why Event-Based `onData` vs. `AsyncIterable`?**: An earlier design exposed `session.output` as an `AsyncIterable`. While powerful, consuming it requires a `for await...of` loop, which can be syntactically awkward if the consumer is not already in an `async` context. The `onData` callback is a more direct and familiar pattern for UI event handling, such as wiring up to `xterm.js`.
-   **Why Automatic Subscription Management?**: The `on...` methods do not return an `unsubscribe` function. This is a deliberate choice to simplify the API and prevent memory leaks. The lifecycle of the session is managed entirely by the library. When `onExit` is fired, all internal listeners are automatically cleared. This removes a significant burden from the developer.
-   **Why a Single `Session` Object?**: The API combines the connection and shell channel into a single `Session` object returned from one function (`startSshSession`). This is a simplification based on the primary use case (a single interactive terminal). It reduces the number of steps and concepts a developer needs to learn.

## 4. Example Usage with `xterm.js`

This example demonstrates how the API is intended to be used in its primary context.

```typescript
import { Terminal } from 'xterm';
import { startSshSession, Session, SshError } from '@mana-ssh/web';

const term = new Terminal();
term.open(document.getElementById('terminal'));

async function setupConnection() {
  let session: Session | undefined;
  try {
    session = await startSshSession({
      url: "ws://localhost:8080",
      username: "user",
      secret: "password",
      hostKeyVerifier: async (key) => true,
      pty: { term: 'xterm-256color', rows: term.rows, cols: term.cols }
    });

    // --- Wire up session events to the terminal ---

    session.onData(data => term.write(data));

    session.onError(error => {
      term.write(`\r\n\x1b[31mSession Error: ${error.message}\x1b[0m`);
    });

    session.onExit(reason => {
      term.write(`\r\n\x1b[90mConnection closed: ${reason.reason}\x1b[0m`);
    });

    // --- Wire up terminal events to the session ---

    term.onData(data => session?.write(data));
    term.onResize(dims => session?.resize(dims));

  } catch (error) {
    // Handles connection-time errors
    if (error instanceof SshError) {
      term.write(`\r\n\x1b[31mConnection Failed: ${error.message}\x1b[0m`);
    } else {
      console.error("An unexpected error occurred", error);
      term.write(`\r\n\x1b[31mAn unexpected error occurred.\x1b[0m`);
    }
  }
}

setupConnection();
```