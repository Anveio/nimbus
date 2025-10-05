# Renderer Bridge

This note explains how `@mana/tui-react` integrates with renderer sessions provided by `@mana/tui-web-canvas-renderer` and future renderer packages.

## High-level responsibilities
- **React layer** orchestrates the VT runtime, user input, accessibility, and selection state. It composes `RendererNextFrameMetadata` and hands it to the renderer session via `presentFrame`.
- **Renderer session** owns drawing (CPU/WebGL/WebGPU) and diagnostics. It accepts observers during creation and emits `onFrame` / `onDiagnostics` events after each paint.
- **Interpreter (`@mana/vt`)** stays the single source of terminal semantics, providing snapshots and update streams.

## Lifecycle in `<Terminal />`
1. `useTerminalCanvasRenderer` (to be renamed when we generalise beyond canvas) creates a renderer session inside a `useEffect` once the `<canvas>` ref is ready.
2. The hook registers observers that forward instrumentation events (`onFrame`, `onDiagnostics`, `onContextLost`) to React props and devtools.
3. Whenever the interpreter runtime produces updates or host overlays change, the hook assembles `RendererNextFrameMetadata` and calls `session.presentFrame(metadata)`.
4. Theme, metrics, or backend changes use `session.configure` so the next frame is rendered with the new context.
5. On unmount, the hook disposes the session and clears DOM dataset hints.

## Frame payload composition

The React layer derives the frame payload from:

- **Interpreter snapshot** – `runtime.interpreter.snapshot` for authoritative screen state.
- **Updates** – Batches collected since the last frame (`TerminalUpdate[]`). Optional optimisation; the renderer will fall back to full repaint if omitted.
- **Viewport + metrics** – Values from `useAutoResize` and resolved styling metrics.
- **Theme** – Resolved styling theme, already expanded to `RendererTheme`.
- **Overlays** – Selection state (`useTerminalSelection`), cursor strategy overrides, future highlight markers.
- **Accessibility hints** – High-contrast preferences, reduced motion/respect system colour scheme.
- **Metadata** – Reason identifier (`'user-input'`, `'resize'`, `'sync'`), incrementing frame counter, optional trace ID for instrumentation.

## Diagnostics flow

- Renderer sessions invoke `onFrame` after painting. The hook relays this to `useTerminalInstrumentation`, which emits events for analytics and developer tooling.
- `getDiagnostics()` snapshots are exposed via the terminal imperative handle (`getDiagnostics`) so hosts can inspect render state on demand.

## Future considerations
- Rename `useTerminalCanvasRenderer` to reflect renderer-agnostic behaviour once sessions are fully adopted.
- Support multiple renderer factories (native, SVG, WebGPU) behind the same session interface.
- Provide testing utilities that stub renderer sessions for jsdom/unit tests while keeping session semantics intact.
