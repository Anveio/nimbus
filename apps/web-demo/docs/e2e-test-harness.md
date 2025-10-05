# Web Demo – E2E Feature Guide

This document captures the end-to-end testing features we maintain inside `apps/web-demo`. It explains how each moving part works, why certain design decisions were made, and what to keep in mind when extending the suite.

## Overview

Our Playwright suite is the source of truth for verifying the rendered terminal experience. We inject bytes directly into the interpreter via a browser harness, capture deterministic canvas snapshots, and assert on interpreter state. The harness isolates UI behaviour from transport concerns while providing hooks that higher-level tests can build upon.

## Feature Inventory

### Global Harness Handle (`window.__manaTerminalTestHandle__`)
- **What it does:** When `VITE_E2E=1` is present, `App.tsx` exposes a small suite of terminal helpers (`write`, `getSnapshot`, `getSelection`, `getResponses`, `getPrinterEvents`, `getDiagnostics`, `getRendererBackend`) on `window.__manaTerminalTestHandle__`. This keeps the app’s public surface unchanged while giving tests a sanctioned way to drive bytes directly into the interpreter and introspect renderer state.
- **Why we need it:** The demo still renders the same UI, but tests can skip brittle DOM typing loops whenever they need precise control over byte streams or want to inspect interpreter state.
- **Important constraints:** The handle is registered after the `Terminal` ref resolves, so specs should wait for the handle to appear (e.g. `page.waitForFunction(() => Boolean(window.__manaTerminalTestHandle__))`) before using it. Inputs may be strings or `Uint8Array` instances; when passing raw bytes from Playwright, convert number arrays to `new Uint8Array(...)` inside `page.evaluate` so they survive the structured clone. Diagnostics depend on the active renderer backend – GPU-specific fields are `null` when the CPU path renders the frame.

### Playwright Interactions
- **What we do now:** Specs focus the terminal like a user (`locator.click()`), then call `window.__manaTerminalTestHandle__?.write(...)` via `page.evaluate`. Snapshots and diagnostics are retrieved through the same handle and asserted in TypeScript.
- **Why it matters:** We keep the automation surface tiny—`write`, `getSnapshot`, and a handful of diagnostics helpers—and rely on Playwright’s own timing guarantees instead of custom animation-frame helpers.

### Visual Snapshots (`toHaveScreenshot` + Baselines)
- **What they do:** After injecting bytes and waiting for idle, we snapshot the `<canvas>` element. Baseline PNGs live beside their specs under `app.spec.ts-snapshots/`.
- **Determinism strategy:**
  - Playwright config pins viewport size, device scale factor, and `colorScheme` to stabilise rendering.
  - We disable cursor blink/animations via the screenshot options, and the harness waits for two animation frames after writes to ensure drawing is complete.

### Test Fixtures (`test/e2e/fixtures/`)
- **Purpose:** Store complex byte streams (e.g., the welcome banner) near the specs that consume them. Keeping them as TypeScript modules enables reuse across multiple scenarios and empowers linting/formatting to catch mistakes.
- **Why not inline inside the React app:** The demo should be minimal; moving showcase content into tests prevents demo-only concerns from affecting runtime bundles.

### Harness Internals (App-level effect)
- **Registration flow:** `App.tsx` schedules a `requestAnimationFrame` loop after mount to wait for the `TerminalHandle`. Once available, it assigns the minimal `{ write, getSnapshot }` object onto `window`. Cleanup removes the handle to avoid leaking state between tests.
- **Idle waits:** We rely on Playwright’s own waiting semantics; no extra animation-frame `await`s are required.

## Extending the Suite

1. **Add a fixture** for any new byte sequences under `test/e2e/fixtures`. Keep them small and well-commented.
2. **Drive through the global handle** (`write`, `getSnapshot`). If we ever need more helpers, add them in `App.tsx` and note them here.
3. **Capture a new snapshot** via `--update-snapshots` and review the generated PNG before committing.
4. **Document additions here** so future contributors understand the rationale and constraints.

## Future Enhancements

- Consider augmenting the global handle with optional helpers (`reset`, `resize`) if future specs require them—keep the surface minimal and documented.
- Surface interpreter diagnostics or renderer metrics through the handle when performance assertions become necessary.
- Add non-visual assertions (e.g., comparing interpreter snapshots against JSON fixtures) to complement pixel diffs.
Keeping this document in sync with implementation changes ensures our automated regression suite remains approachable and reliable.
