# @mana/web Agent Charter

This charter anchors the mandate, guardrails, and rituals for the Mana web host SDK. Revise it whenever scope, interfaces, or risks shift.

## Mandate
- Deliver a batteries-included browser SDK that spins up a production-grade Mana terminal with a handful of configuration options.
- Compose interpreter, renderer, transport, and telemetry layers so SaaS teams integrate SSH without re-learning protocol internals.
- Expose escape hatches for advanced hosts to swap transports, renderer themes, authentication, and observability without forking the stack.

## Boundaries & Dependencies
- Owns all browser host orchestration housed in `packages/web` (session controller, default UI scaffolding, configuration schema, diagnostics plumbing).
- Depends on:
  - `@mana/vt` for terminal semantics and diff emission.
  - `@mana/tui-react` + `@mana/tui-web-canvas-renderer` for UI composition; may default to React but must keep a framework-neutral entry point.
  - `@mana/ssh` for protocol state machines and crypto, consuming the `client/web` surface by default.
  - `@mana/websocket` for the default transport adapter.
- Does **not** ship backend proxy code, key management services, or bespoke customer integrations. Delegate those to hosts or sibling apps.

## Product Surfaces
- High-level factory (e.g. `createManaWebTerminal`) that mounts a terminal, manages connection lifecycle, and returns an imperative handle and observability hooks.
- React-ready component wrapper that re-exports the factory with sensible defaults for JSX consumers.
- Configuration schema covering authentication strategy, transport endpoint(s), renderer theme, feature flags (clipboard, selection, file transfer), and telemetry sinks.
- Test harness helpers mirroring Playwright/Vitest fixtures so downstream apps can script terminals without duplicating setup logic.

## Design Pillars
- **Minutes to “Hello”**: Sensible defaults (font, theme, reconnect policy, logging) let teams embed a terminal with minimal code.
- **Secure-by-default**: Enable bracketed paste, strict clipboard policies, connection backoff, and audit logging out of the box; require explicit opt-in to relax.
- **Composable layers**: Keep transport, renderer, and telemetry swappable via typed interfaces. Avoid hard-coding WebSocket-only or React-only pathways.
- **Observable runtime**: Emit structured events (connection, auth, channel, resize, error) and metrics via callbacks so hosts can wire their own observability stacks.
- **Deterministic UX**: Defer to package-level specs for keyboard, selection, and resize behaviour; ensure the SDK does not diverge from `@mana/tui-react` contracts.

## Non-Goals
- Running in privileged Node.js or server environments (covered by `@mana/ssh/server/node`).
- Providing UI chrome beyond terminal necessities (no dashboards, user management, or billing logic).
- Hiding the raw SSH protocol: advanced consumers must still reach the lower-level clients via exports.

## Testing Doctrine
- Unit tests (Vitest) over session controllers, configuration parsing, and adapter contracts.
- Integration tests that spin up mocked transports (loopback WebSocket) and verify reconnection, auth retry, and telemetry emission.
- Shared Playwright scenarios (likely co-located with `apps/terminal-web-app`) that validate “drop-in” flows, reduced-motion handling, and error propagation to host callbacks.
- Type boundary tests ensuring exported types remain tree-shakeable and do not drag in Node-only dependencies.
- Release gating: `npm run lint`, `npm run typecheck`, package unit/integration suites, plus the demo app e2e smoke before publishing.

## Roadmap Signals
- Author a formal configuration spec (YAML/JSON examples) and document feature toggles for clipboard, file transfer, and session recording.
- Build transport policy interface (WebSocket default, retry/backoff strategy hooks, future QUIC/HTTP3 adapters).
- Integrate telemetry adapters (console, structured logger, OpenTelemetry bridge) with sampling controls.
- Harden auth flows: token refresh hooks, webauthn handshake support, and connection guardrails for multi-tenant SaaS hosts.
- Publish reference docs + quick-start recipe that align with README promises.

## Collaboration Rituals
1. Validate whether a requested change belongs in the host SDK versus lower layers; escalate cross-package impacts early.
2. Update or create spec entries before altering behaviour; pair spec changes with configuration docs.
3. Land changes behind feature flags when behaviour is experimental; document defaults in the README and package docs.
4. Keep the `apps/terminal-web-app` integration green—it serves as our production-like acceptance test.
5. Log notable decisions, risks, and follow-ups in the repository memory bank with dates.

## Open Questions
- Finalise the compliance hook surface for enterprise SSO: which abstractions cover token acquisition, policy gates, risk scoring, and audit logging without forcing SDK forks?
- Document the official browser support policy (currently targeting the latest three stable releases of Edge, Chrome, Safari, and Firefox)—what automated coverage backs that guarantee?
- Define the metrics callback contract so consumers can forward data into their own observability systems without first-party vendor integrations.

Keep this charter close at hand—update it as soon as answers land or scope evolves.
