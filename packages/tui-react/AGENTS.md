# @mana/tui-react Agent Charter

This charter guides how we evolve the React bindings for the Mana terminal stack. Update it whenever architectural shifts, risks, or rituals change.

## Mandate
- Deliver a zero-boilerplate React terminal component that orchestrates parser, interpreter, renderer, and host wiring on behalf of application code.
- Provide ergonomic hooks and handles so advanced hosts can compose custom transports, telemetry, and accessibility overlays without forking core logic.
- Keep the package renderer-agnostic—React coordinates lifecycle and input; concrete drawing backends live in sibling renderer packages.

## Boundaries & Dependencies
- Owns React-specific controllers, hooks, and components located in `packages/tui-react`.
- Depends on `@mana/vt` for terminal semantics and on renderer packages (e.g. `@mana/tui-web-canvas-renderer`) for drawing.
- Never inline transport, crypto, or DOM-global hacks.

## Design Pillars
- **Presentation-only**: Treat VT + renderers as injected collaborators. React components marshal updates and inputs but never implement parser logic.
- **Renderer abstraction**: Maintain a registry-driven interface so canvas, SVG, WebGL, or native renderers can plug in without changing React code.
- **Controller hook**: `useTerminalController` owns diff buffering, diagnostics, and synchronization between interpreter and renderer. The hook must stay pure/testable.
- **UX discipline**: Keyboard, pointer, selection, and clipboard flows should respect modern terminal ergonomics (Ghostty/xterm parity) while still emitting canonical escape sequences to hosts.
- **Accessibility & ergonomics**: Provide focus management, screen-reader affordances, and theming hooks by default, with escapes for hosts to customize.

## Testing Doctrine
- Unit & component tests: `npm exec vitest run` inside `packages/tui-react` with React Testing Library/jsdom to cover hooks, lifecycle, and imperative handles. Co-locate unit tests alongside source modules (e.g. `src/hooks/useAutoResize.ts` ↔ `src/hooks/useAutoResize.test.tsx`).
- Integration: Contract tests with `@mana/tui-web-canvas-renderer` ensure renderer swapping, selection propagation, and diagnostics remain stable.
- End-to-end: Package-local Playwright harness (`npm run test:e2e`) mounts `<Terminal />`, drives keyboard flows, and runs `axe-core` scans; keep it green alongside the `apps/web-demo` Playwright suite that exercises full host flows.
- Type discipline: `npm run typecheck` across the monorepo before landing changes; avoid ambient `any` escape hatches.
- Spec-first workflow: Update or author package-level specs (e.g. controller lifecycle, selection semantics) prior to modifying code/tests.

## Active Focus / Backlog Signals
- Finalise the opinionated `<Terminal />` component that owns parser/interpreter/renderer wiring while remaining renderer-swappable.
- Harden keyboard + pointer selection parity (Shift/Option/Meta semantics, word jump rules) and ensure interpreter deltas map to renderer selection overlays.
- Auto-resize via ResizeObserver and font metrics, exposing row/column info through the imperative handle and diagnostics channel.
- Extend host/clipboard APIs for OSC 52, bracketed paste, mouse tracking, and connection diagnostics.
- Surface theming utilities and accessibility toggles (high-contrast, caret styles) without forcing downstream DOM manipulation.

## Collaboration Rituals
1. Confirm whether a request belongs in React bindings, renderer implementation, or VT core before coding.
2. Propose an implementation strategy, gain approval, and update specs → tests → code in that order.
3. Run package unit tests plus any impacted integration/e2e suites before shipping.
4. Log consequential changes, gaps, and decisions in the memory bank with dates for future maintainers.

## Memory Bank
### 2025-10-03 – Terminal composition refactor
- Promoted `<Terminal />` to a pure composer by extracting instrumentation, printer, accessibility, scroll, and selection logic into dedicated hooks/layers (`useTerminalInstrumentation`, `usePrinterController`, `useTerminalAccessibility`, `useTerminalSelection`).
- Removed the built-in WebSocket transport implementation; hosts now own transports and can listen to `instrumentation.onData` to bridge bytes outward.
- Added unit coverage for the instrumentation hook and updated docs/tests to reflect the leaner surface.

### 2025-10-08 – Hotkey module extraction
- Moved keyboard handling into `hotkeys/handler.ts`, keeping `<Terminal />` focused on interpreter/render orchestration.
- The `HotkeyContext` captures interpreter motion helpers, selection refs, and IO callbacks, paving the way for configurable bindings.
- Unit + E2E coverage exercise the new module; future work is to expose a public API for custom key maps.

### 2025-10-10 – Renderer root v1 adoption
- Rebuilt `<Terminal />` around the spec v1 `createRendererRoot` contract, keeping renderer selection injectable while defaulting to WebGL.
- Component now auto-manages container provisioning, ResizeObserver-driven `renderer.configure` dispatches, and profile updates without remounting sessions.
- Added Vitest coverage faking the renderer root/session to guard resize, profile, and disposal flows; future work: hot path input + transport wiring.

### 2025-10-11 – Renderer layering extraction
- Split `<Terminal />` into composable layers: `RendererRootBoundary` guarantees DOM container → renderer root wiring, while `RendererSessionProvider` owns runtime mounting, configuration, and lifecycle hooks.
- Added `RendererSurface` to render or adopt the concrete DOM node that renderers mount to, keeping surface concerns isolated from session orchestration.
- `<Terminal />` now composes those layers and only supplies the imperative handle; consumers can embed the boundary/surface/provider stack directly when they need lower-level control.
- Added hooks (`useRendererRoot`, `useRendererSessionContext`) and exported providers to encourage reuse in accessibility overlays and future renderer hosts.

### 2025-10-02 – Terminal props consolidation + managed transport *(superseded by 2025-10-03 refactor)*
- Collapsed the `<Terminal />` surface into nested `accessibility`, `styling`, `graphics`, `instrumentation`, and `transport` option blocks. Back-compat shims remain, but new work should target the structured API.
- Renderer selection now hinges on string backends (`cpu`, `webgl`, `webgpu`) routed through the canvas renderer package; the imperative handle exposes `getRendererBackend()` and frame callbacks ship richer diagnostics via `instrumentation.onFrame`.
- Introduced an opt-in WebSocket transport that handled connection state, reconnect policy, and ingress/egress wiring so simple hosts could forgo bespoke plumbing. This path is now removed; see 2025-10-03 notes.

### 2025-10-07 – Shortcut guide overlay + focus discipline
- Defaulted `<Terminal />` focus to opt-in and shipped a built-in Shift + `?` modal surfaced through `useTerminalAccessibilityAdapter` / `TerminalAccessibilityLayer`.
- Added imperative + callback hooks so hosts can open, close, or replace the guide, while keeping the visually hidden instructions for screen readers.
- Next follow-up: expose visible entry points in host UIs and localise the shortcut descriptions before broad rollout.

### 2025-10-06 – Vite build + Playwright harness
- Swapped the package build to Vite library mode (ESM + CJS + bundled declarations) and published the output from `dist/`.
- Added a package-scoped Playwright + axe harness that bundles a React test surface via Vite, feeding smoke & accessibility checks through `npm run test:e2e`.
- Unified the npm script surface so `npm run test` fans out to Vitest and Playwright, mirroring the renderer package’s patterns.

### 2025-09-30 – Charter refresh
Reframed the React agent charter around mandate, boundaries, and testing doctrine; promoted the `<Terminal />` rewrite, selection parity, and auto-resize as active backlog signals.

### 2025-09-27 – React terminal component rewrite
- Designing an opinionated `<Terminal />` that instantiates parser/interpreter/renderer, exposes `write/reset/focus`, and streams keyboard/paste events to hosts while supporting local echo.
- Planned Vitest coverage for lifecycle, keystrokes, ref methods, diagnostics, and renderer swapping.
- Auto-resize and diagnostic surfacing identified as core acceptance criteria; documentation refresh queued to showcase the simplified API.

### 2025-09-27 – Selection + input ergonomics
Documented selection lifecycle: pointer drag, keyboard extension, auto-scroll, and word/line semantics aligned with Ghostty. Ensured imperative handles expose `getSelection()` and callbacks unify pointer/keyboard sources.

### Early status (undated)
- Established renderer registry, controller hook, and host abstraction shared with canvas renderer and demo app.
- Scaffolded keyboard input path emitting native escape sequences while updating local state for immediate visual feedback.
- Demo app integration confirmed zero-glue embedding via `<TerminalCanvas />` proof-of-concept.
