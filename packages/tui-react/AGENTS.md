# @mana-ssh/tui-react Agent Charter

This charter guides how we evolve the React bindings for the Mana SSH terminal stack. Update it whenever architectural shifts, risks, or rituals change.

## Mandate
- Deliver a zero-boilerplate React terminal component that orchestrates parser, interpreter, renderer, and host wiring on behalf of application code.
- Provide ergonomic hooks and handles so advanced hosts can compose custom transports, telemetry, and accessibility overlays without forking core logic.
- Keep the package renderer-agnostic—React coordinates lifecycle and input; concrete drawing backends live in sibling renderer packages.

## Boundaries & Dependencies
- Owns React-specific controllers, hooks, and components located in `packages/tui-react`.
- Depends on `@mana-ssh/vt` for terminal semantics and on renderer packages (e.g. `@mana-ssh/tui-web-canvas-renderer`) for drawing.
- Exposes typed contracts (`TerminalHost`, renderer registry, imperative handle) consumed by apps (`apps/terminal-web-app`) and future environments. Never inline transport, crypto, or DOM-global hacks.

## Design Pillars
- **Presentation-only**: Treat VT + renderers as injected collaborators. React components marshal updates and inputs but never implement parser logic.
- **Renderer abstraction**: Maintain a registry-driven interface so canvas, SVG, WebGL, or native renderers can plug in without changing React code.
- **Host contract**: Keep `TerminalHost` small (`write`, `onData`, `resize`, `dispose`) and transport-neutral. Ensure imperative handles forward lifecycle hooks predictably.
- **Controller hook**: `useTerminalController` owns diff buffering, diagnostics, and synchronization between interpreter and renderer. The hook must stay pure/testable.
- **UX discipline**: Keyboard, pointer, selection, and clipboard flows should respect modern terminal ergonomics (Ghostty/xterm parity) while still emitting canonical escape sequences to hosts.
- **Accessibility & ergonomics**: Provide focus management, screen-reader affordances, and theming hooks by default, with escapes for hosts to customize.

## Testing Doctrine
- Unit & component tests: `bunx vitest run` inside `packages/tui-react` with React Testing Library/jsdom to cover hooks, lifecycle, and imperative handles.
- Integration: Contract tests with `@mana-ssh/tui-web-canvas-renderer` ensure renderer swapping, selection propagation, and diagnostics remain stable.
- End-to-end: Rely on `apps/terminal-web-app` Playwright suite for behavioural coverage (keyboard semantics, pointer selection, clipboard). Coordinate changes across repos when public APIs shift.
- Type discipline: `bun run typecheck` across the monorepo before landing changes; avoid ambient `any` escape hatches.
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

