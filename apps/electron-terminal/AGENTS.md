# apps/electron-terminal Agent Charter

## Mission

Think of Mana Electron Terminal as the desktop counterpart to our web demo—a zero-dependency Electron shell that proves the entire Mana stack can run outside the browser. Its mission:

1. Bring Mana Local – Bundle the Mana terminal renderer (@mana/tui-react) in a native-feeling desktop app so teams can ship the same high-performance terminal experience without a browser.
2. Bridge Any Session – Provide the glue to attach either to a remote SSH host (via our websocket transport) or to a local PTY, showcasing how the engine can power DevOps, customer support consoles, or managed infrastructure tooling.
3. Ship Confidence – Serve as the reference implementation for desktop partners: clean Electron scaffolding, transparent diagnostics, and Playwright E2E coverage that exercises the UI end-to-end.

It’s a teaching tool and a launchpad: demonstrate best practices, validate the stack in a new runtime, and give downstream teams a ready-made starting point for their own desktop-class terminals.

## Mandate
- Deliver a zero-dependency Electron shell that can host the Mana terminal renderer.
- Provide a bridge for both local PTY sessions (when available) and remote SSH sessions over `@mana/websocket`.
- Serve as the desktop integration reference for downstream partners.

## Scope
- Bootstrap Electron main/preload/renderer wiring.
- Compose the renderer using `@mana/tui-react` and the websocket client.
- Expose diagnostics and lifecycle hooks to demonstrate how desktop apps should monitor connection health.
- Ship Playwright-driven E2E coverage that exercises the bundled renderer inside Electron (Phase 2).

## Out of Scope (initially)
- Packaging/signing installers.
- Production-grade PTY integration (stubbed until native module lands).
- Offline credential storage or keychain integration.

## Status
- **Phase 1** – Scaffolding (hello-world app, build scripts, docs). ✅
- **Phase 2** – Integrate terminal renderer, websocket bridge, and local PTY adapter.
  - Embed `<Terminal />` from `@mana/tui-react` inside the Electron renderer with a zero-glue adapter that forwards instrumentation events into the preload bridge.
  - Provide a deterministic data path: initial milestone uses the websocket SSH bridge talking to the simulated instance; a PTY shim follows once native bindings land.
  - Document renderer ↔ main-process message channels so downstream teams can slot in their own transports without forking the UI layer.
- **Phase 3** – Harden error UX, telemetry, and packaging.

## Rituals
- Keep build scripts aligned with monorepo tooling (`npm`, `esbuild`).
- Maintain zero-dependency posture: no additional NPM packages beyond Electron, esbuild, and TypeScript.
- Document runtime behaviours in the local README.
- Update the preload/main IPC contract whenever transports change; renderer never reaches into Node APIs directly.

## Architecture Notes (2025-01-07)
- Renderer owns presentation only. All session orchestration flows through an injected `ElectronTerminalBridge` exposed on `window.mana`. The bridge surfaces diagnostics, connection state, and a bidirectional byte channel.
- The bridge forwards outbound data to the main process over IPC, where we multiplex between websocket SSH sessions and (eventually) PTY adapters.
- `<Terminal />` instrumentation hooks (`onData`, `onDiagnostics`, `onFrame`, `onCursorSelectionChange`) provide parity with the web shell; no bespoke renderer logic required.
- Playwright e2e coverage launches the packaged Electron app and asserts end-to-end rendering + transport IO by reusing the tui-react harness expectations against the embedded window.
