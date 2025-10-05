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
- **Phase 1** – Scaffolding (hello-world app, build scripts, docs).
- **Phase 2** – Integrate terminal renderer, websocket bridge, and local PTY adapter.
- **Phase 3** – Harden error UX, telemetry, and packaging.

## Rituals
- Keep build scripts aligned with monorepo tooling (`bun`, `esbuild`).
- Maintain zero-dependency posture: no additional NPM packages beyond Electron, esbuild, and TypeScript.
- Document runtime behaviours in the local README.
