# Terminal Web App Agent Charter

This document anchors how we evolve the reference browser experience. Revise it whenever demo obligations, harness interfaces, or testing rituals shift.

## Mandate
- Prove that the Mana stack (VT → renderer → React) delivers a production-grade terminal in the browser with zero glue code.
- Act as the canonical host for Playwright end-to-end coverage, instrumentation, and UX experiments.
- Demonstrate secure transport wiring patterns (proxy server, simulated host) that align with AWS security expectations.

## Boundaries & Dependencies
- Lives entirely inside `apps/terminal-web-app` (Vite-powered React app).
- Depends on `@mana/tui-react` and renderer packages for terminal UI, and on `apps/proxy-server` / `apps/simulated-instance` for integration scenarios.
- Owns the Playwright harness (`test/e2e`), test handle (`window.__manaTerminalTestHandle__`), and demo-specific instrumentation. Core terminal behaviour belongs upstream.

## Experience Pillars
- **Zero-boilerplate embed**: `<Terminal />` mounts with sensible defaults (focus, local echo, metrics) and exposes imperative handle for demos/tests.
- **Transport showcase**: Optional WebSocket bridge demonstrates round-trip SSH traffic through the proxy server with secure defaults.
- **Accessibility + UX**: Surface focus cues, ARIA hints, screen-reader-friendly transcripts, and visual diagnostics (connection state, FPS, draw counts).
- **Observability**: Provide toggles or overlays to visualize renderer diagnostics, selection state, and host latency.
- **Spec layering**: Reflect spec-compliant behaviour while offering user-friendly affordances (Backspace delete, copy-on-select) via adapters, never by mutating VT core.

## Testing Doctrine
- Unit/component: `bunx vitest run` validates layout scaffolding and harness wiring.
- End-to-end: Playwright suite under `test/e2e` covers typing, paste, resize, selection, clipboard, device reports, and regression scenarios. Run `bun run test:e2e --filter apps/terminal-web-app` (or full `bun run test`) before shipping any behavioural change.
- Harness contract: `window.__manaTerminalTestHandle__` must expose deterministic helpers (`write`, `injectBytes`, `awaitIdle`, `getSnapshot`, etc.). Document additions in `docs/e2e-test-harness.md` alongside code changes.
- Type discipline & linting: `bun run typecheck` + `bun run lint` at repo root prior to commit.

## Active Focus / Backlog Signals
- Wire an optional WebSocket demo path that relays `onData` to the proxy server, gated by environment configuration.
- Expand accessibility polish: focus management, live-region output for bell/status lines, high-contrast themes, and keyboard navigation cues.
- Surface diagnostics overlays (renderer FPS/draw calls, host latency) with toggles suitable for demos and tests.
- Integrate clipboard pathways (OSC 52, copy-on-select) once interpreter + React layers expose the necessary hooks.
- Grow Playwright scenarios for paste workflows, resize semantics, selection/clipboard flows, device status reports, and regression for layered adapters.

## Collaboration Rituals
1. Decide whether a feature belongs in the demo app or upstream packages; avoid demo-specific forks of shared logic.
2. Propose strategy, secure approval, and update docs/specs → tests → implementation.
3. Run Playwright suite plus relevant unit tests before landing changes; attach new artifacts when scenarios evolve.
4. Record harness changes, UX decisions, and outstanding work in the memory bank with dates.

## Memory Bank
### 2025-09-30 – Charter refresh
Reframed the demo app mandate around zero-boilerplate embedding, Playwright stewardship, and transport showcases; highlighted WebSocket wiring, accessibility polish, diagnostics overlays, clipboard integration, and expanded e2e coverage as active priorities.

### 2025-09-27 – Harness handle expansion
`window.__manaTerminalTestHandle__` gained deterministic helpers (`write`, `getSnapshot`, `getSelection`) for Playwright; clipboard permissions wired, revealing gaps in keyboard-driven selection propagation that require upstream fixes.

### Early status (undated)
- `<Terminal />` renders with local echo, auto-focus, and welcome banner injection.
- Vitest smoke tests cover scaffold rendering; Playwright smoke verifies typing loop.
- Dev/build/test scripts configured via Vite; documentation cadence established for future harness updates.

