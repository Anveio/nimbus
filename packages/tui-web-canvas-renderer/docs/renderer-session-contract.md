# Renderer Session Contract

This document captures the canonical contract between hosts (React, Electron, web components) and the `@mana/tui-web-canvas-renderer` session API. It should remain in lockstep with the TypeScript definitions exported from `src/types.ts`.

## Goals
- Provide a single imperative entry point (`presentFrame`) for delivering interpreter state and host adornments to the renderer.
- Keep rendering pipelines backend-agnostic (CPU, WebGL, WebGPU, custom) while sharing diagnostics and lifecycle semantics.
- Remove host responsibilities for diff scheduling, dataset bookkeeping, and context management.

## Session Lifecycle
1. **Creation** – Hosts call `createRendererSession({ canvas, backend, observers, options })` to choose a backend and register observers. The session immediately prepares glyph atlases, metrics caches, and backend resources.
2. **Configuration** – Hosts may call `session.configure({ metrics?, theme?, backend?, observers? })` at any time to adjust renderer state without triggering a paint. Changes take effect on the next `presentFrame` call.
3. **Rendering** – `session.presentFrame(frame)` consumes the full renderer payload. The session decides whether to apply incremental updates, diff snapshots, or repaint from scratch. Diagnostics (`onFrame`, `onDiagnostics`) fire after the frame completes.
4. **Introspection** – `session.getDiagnostics()` returns the most recent diagnostics payload for polling workflows (e.g. dashboards, devtools overlays).
5. **Disposal** – `session.dispose()` tears down timers, releases GPU/CPU resources, removes dataset annotations, and nulls references to avoid leaks.

The session owns context-loss handling. When a backend reports loss or failure, the session notifies observers via `onContextLost`, attempts recovery if possible, and falls back to CPU rendering when configured.

## RendererNextFrameMetadata

Every frame hand-off is self-contained. Hosts supply all inputs needed to paint the next frame.

| Field | Type | Responsibility |
| --- | --- | --- |
| `snapshot` | `TerminalState` | Authoritative interpreter state. Renderer may diff against internal caches to validate incremental updates. |
| `updates?` | `ReadonlyArray<TerminalUpdate>` | Optional acceleration hint from the interpreter. The renderer must verify compatibility before applying. |
| `epoch` | `number` | Monotonic stamp for sanity checks and debugging. Sessions may drop frames that arrive out-of-order. |
| `viewport` | `{ rows: number; columns: number }` | Logical grid dimensions derived from the interpreter/runtime. |
| `metrics` | `RendererMetrics` | Physical rendering metrics (cell size, font metrics, device pixel ratio). |
| `theme` | `RendererTheme` | Colours, cursor styling, and palette data. |
| `overlays` | `RendererFrameOverlays` | Host-managed visual layers (selection, cursor, highlights, diagnostics markers). |
| `accessibility?` | `RendererFrameAccessibility` | Flags for high-contrast modes, colour transforms, or platform hints. |
| `metadata?` | `RendererFrameMetadata` | Optional bag for `frameId`, `reason`, and host-defined trace data. |

### Overlays

Overlays describe non-interpreter visual layers. The initial schema includes:

- `selection?: TerminalSelection | null` – The current selection region. Renderers apply the correct theme layer before glyph paints.
- `cursor?: RendererCursorDescriptor` – Cursor visibility, shape, and optional animation hints.
- `highlights?: ReadonlyArray<RendererHighlight>` – Future extension for search matches or diagnostics markers.

The `overlays` bag should evolve additively; renderers must ignore unknown fields to stay forward compatible.

### Accessibility Hints

The `accessibility` object surfaces runtime flags:

- `highContrast: boolean` – Toggle high-contrast palettes.
- `colorScheme?: 'light' | 'dark' | 'system'` – Host preference for theme selection.
- `reducedMotion?: boolean` – Hosts request minimal animations (e.g. cursor blinking).

Renderers should treat these as hints and never diverge from interpreter semantics.

## Observers & Diagnostics

- `onFrame(event)` – Called after each successful `presentFrame`. Includes `backend`, timestamps, dirty stats, and the optional `metadata` bag from the frame payload.
- `onDiagnostics(diagnostics)` – Publishes the raw diagnostics struct (draw counts, GPU stats, recent control sequences).
- `onContextLost(reason)` – Fired when the backend context is lost or the session falls back to another backend.

Observers are registered once during session creation. Swapping observers uses `session.configure({ observers })` to avoid re-allocating closures in the critical path.

## Host Responsibilities
- Maintain interpreter state (`@mana/vt` runtime) and build `RendererNextFrameMetadata` on every update.
- Call `presentFrame` in response to interpreter deltas, viewport changes, or host overlay updates.
- Surface diagnostics through their own instrumentation layers without reading canvas internals.

## Renderer Responsibilities
- Validate and apply updates, painting pixels immediately.
- Manage GPU/CPU resources, including context loss and resizing.
- Emit diagnostics and observer callbacks reliably after each frame.
- Ignore unknown metadata fields to preserve compatibility across hosts.

## Future Work
- Explicit pull-based loop (`session.requestFrame(fn)`) for animation-driven flows.
- Shared session core for native renderers (`@mana/tui-renderer-core`).
- Rich overlay descriptors (hyperlink/OSC 8 highlighting, diagnostics markers).
