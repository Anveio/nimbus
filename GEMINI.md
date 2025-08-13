### Wednesday, August 13, 2025

**Summary of Work Done:**

-   Conducted a deep design session for the public API of the `@mana-ssh/web` package.
-   Iteratively refined the API based on principles of simplicity, developer ergonomics, and robust error handling, while ensuring the internal `Effect` implementation is completely hidden from the consumer.
-   The final API design is functional (not class-based) and focused exclusively on the primary use case of a browser-based interactive shell (e.g., for `xterm.js`).
-   Key design decisions solidified:
    1.  **Error Handling**: Shifted from a `Result` object to a more conventional `Promise`-based API that `throws` typed, custom `Error` subclasses (`SshError`, `ConnectionError`, etc.) for explicit and robust error handling in `try...catch` blocks.
    2.  **API Surface**: Simplified to a single entry point, `startSshSession`, which returns a `Session` handle.
    3.  **In-Session Events**: Adopted a fully event-driven model for the active session using `onData`, `onError`, and `onExit` callbacks.
    4.  **Lifecycle Management**: The library will now handle subscription cleanup automatically when a session ends, removing this burden from the developer and preventing memory leaks.
    5.  **Ergonomics**: The `session.write` method was updated to accept `string` directly to simplify its use with UI components.
-   Updated `packages/web/README.md` with a comprehensive document detailing the final public API, its design principles, rationale for key decisions, and a clear usage example.

**What Remains To Be Done / Next Steps:**

1.  **Implementation**: The public API is now designed, but the underlying implementation needs to be built.
2.  **Effect-to-Promise Bridge**: The core implementation task is to create the internal "bridge" that uses `Effect` to manage the SSH protocol and WebSocket state, while exposing it via the Promise-based, event-driven public API. This will likely involve managing an `Effect` `Runtime` internally.
3.  **Error Mapping**: Implement the logic to catch internal `Effect` failures and map them to the appropriate public `SshError` classes to be thrown.
4.  **Stream to Event-Callback Bridging**: The internal `Effect.Stream` that represents the shell's output needs to be bridged to the `onData` callback system, carefully managing backpressure and lifecycle.
5.  **Testing**: Develop a comprehensive test suite to validate the functionality and error-handling of the public API.
6.  **API Re-evaluation**: As implementation begins, we must be mindful that unforeseen complexities in the underlying protocol might require minor adjustments to the public API we have designed. The current API is a strong target, but should be considered provisional until the implementation is further along.
