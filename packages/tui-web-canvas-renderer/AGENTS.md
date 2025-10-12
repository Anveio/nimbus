# @nimbus/tui-web-canvas-renderer Agent Charter

This charter defines how we evolve the web canvas renderer. Update it when renderer capabilities, risks, or rituals shift.

## Mandate
- Render `@nimbus/vt` interpreter diffs into high-fidelity pixels using HTML canvas surfaces (2D + optional GPU paths).
- Provide a stable renderer contract (`init`, `applyUpdates`, `sync`, `dispose`) that downstream hosts can adopt without depending on implementation details.
- Serve as the reference implementation for future renderers (SVG, WebGL, native) by documenting expectations, performance baselines, and testing rituals.

## Boundaries & Dependencies
- Owns drawing pipelines, glyph atlases, palette management, and selection/cursor overlays within `packages/tui-web-canvas-renderer`.
- Consumes typed diffs, snapshots, and metadata exclusively from `@nimbus/vt`; never implement terminal semantics locally.
- Exposes diagnostics and lifecycle hooks consumed by `@nimbus/tui-react`, demo apps, and test harnesses. No transport or React logic belongs here.

## Design Pillars
- **Renderer-only responsibility**: Treat terminal state as read-only input. Keep side effects confined to canvas contexts and instrumentation callbacks.
- **Performance discipline**: Batch draws, minimise allocations, honour dirty regions, and support HiDPI/offscreen canvases for smooth playback.
- **Fidelity & accessibility**: Accurately render Unicode (wide cells, combining marks), SGR attributes, palette updates, cursor variants, and selection themes while enabling high-contrast modes.
- **Extensibility**: Keep glyph atlas, shader, and metrics plumbing modular so alternative backends can reuse shared helpers.
- **Resilience**: Handle resize, context loss, and palette changes gracefully, with deterministic cleanup on `dispose`.

## Renderer Contract Snapshot
- `init(options)`: Bind to a canvas, prepare atlases/metrics, return an object exposing `applyUpdates`, `sync`, `dispose`, and diagnostics getters.
- `applyUpdates({ snapshot, updates?, metrics?, theme? })`: Consume `TerminalUpdate` arrays and optional theme/metric changes, reconciling state with minimal redraws (full repaints when metrics/theme shift).
- `dispose()`: Tear down timers, release WebGL contexts, and clear references.
- Diagnostics: Expose frame timing, draw counts, palette state, and current selection so hosts can introspect behaviour.

## Renderer Session Contract
See `docs/renderer-session-contract.md` for the normative specification and TypeScript signatures.
- `createRendererSession({ canvas, backend, observers })` is the canonical entry point. It chooses the backend, bootstraps atlases, and freezes the observer set (`onFrame`, `onDiagnostics`, `onContextLost`, etc.) so the hot render path never reallocates callbacks. Hosts swap observers through `session.configure` rather than per-frame arguments.
- `session.configure({ metrics?, theme?, backend?, observers? })` mutates renderer configuration without repainting. Use it when DPR, font metrics, or backend preference changes between frames; the next `presentFrame` will honour the updated state.
- `session.presentFrame(frame: RendererNextFrameMetadata)` immediately drives the draw pipeline. The renderer decides whether to replay incremental `updates`, diff snapshots, or repaint wholesale. Rendering side effects (canvas mutations, GPU submissions) happen synchronously by default; diagnostics fire once the frame is committed.
- `session.getDiagnostics()` returns the last published diagnostics object so hosts can poll outside observer callbacks. `session.dispose()` releases contexts, timers, GPU resources, and clears dataset bookkeeping.

### RendererNextFrameMetadata responsibilities
- **Interpreter state**: `snapshot` is authoritative VT state. `updates` is an optional fast-path hint derived from the same interpreter epoch; the renderer may discard it and fall back to `snapshot` if validation fails.
- **Viewport + metrics**: `viewport` (rows, columns) and `metrics` (cell + font + DPR) describe the logical and physical layout. The renderer maps them to canvas dimensions and atlas caches.
- **Visual layers**: `overlays` carries host-managed adornments (selection, cursor, highlighted ranges, diagnostics markers). The renderer enforces draw order (background, glyphs, overlays) while keeping the interpreter core pure.
- **Presentation hints**: `theme`, `accessibility` (high contrast flags, colour adjustments), and optional `metadata` (frame id, reason) guide shader/theme selection and feed through to diagnostics.
- **Invariant**: Every call is self-contained. The renderer never asks the host for missing state; hosts hand over the full picture each frame so we can support push- and pull-based runtimes, capture tools, and future renderer backends identically.

### Division of responsibility
- **Renderer**: Consume `RendererNextFrameMetadata`, paint pixels, manage GPU/CPU resources, emit diagnostics, handle context loss, and keep atlas/selection caches coherent.
- **Host (e.g. `tui-react`)**: Observe interpreter changes, compose the next metadata payload (including overlays/accessibility flavours), call `presentFrame`, and listen to observers. Hosts never mutate canvas contexts directly.
- **VT interpreter**: Remains the single source of terminal semantics. Renderers do not implement escape handling or screen state mutation; they render what `snapshot` describes.

## Testing Doctrine
- Pixel regression: Vitest harness renders canonical snapshots via node-canvas + `pixelmatch`; failures emit expected/actual/diff/side-by-side artifacts under `test/__artifacts__`.
- Scenario coverage: ASCII/CJK/emoji glyphs, SGR permutations, palette swaps (OSC 4/104, true colour), cursor modes, selection overlays, resize paths, diagnostics toggles.
- Performance smoke: Track draw call counts and frame duration for large dirty regions to catch regressions.
- Spec traceability: `docs/renderer-test-spec.md` records coverage with ✅/🟡/⛔️ status; update it before adding/removing fixtures.
- Type discipline: `npm run typecheck` at the workspace root and `npm exec vitest run -- --runInBand` locally prior to landing changes.

## Active Focus / Backlog Signals
- Finalise `selection:*` deltas consumption—paint themed highlights for normal/rectangular selections with new pixel baselines.
- Extend diagnostics surface (OSC/DCS logs, FPS, draw timings) and expose them through the renderer handle for host dashboards.
- Add HiDPI/offscreen canvas support with graceful fallback when contexts fail.
- Prepare GPU/WebGL backend parity: shared metrics, glyph atlas API, and contract tests validating interface compatibility.
- Investigate Sixel/kitty graphics roadmap and define renderer hooks for binary payload channels.

## Collaboration Rituals
1. Confirm whether a change belongs in renderer internals or upstream VT/React layers before editing.
2. Update specs/docs → tests → implementation; never land code without corresponding pixel or unit coverage.
3. Run `npm exec vitest run` for this package and any dependent integration tests prior to submission.
4. Record significant capability additions, diagnostics changes, or gaps in the memory bank with precise dates.

## Memory Bank
### 2025-09-30 – Charter refresh
Codified renderer mandate, contract, and testing doctrine; highlighted selection overlays, diagnostics expansion, and HiDPI/offscreen support as active backlog signals.

### 2025-10-02 – Selection roadmap alignment
- Mapped Ghostty-inspired selection lifecycle onto VT deltas; renderer to consume row-level segments with themed overlays.
- Planned pixel fixtures for single-line, multi-line, and rectangular highlights; coordinated testing across VT, React, and Playwright layers.
- Established `TerminalSelection` shape and renderer responsibilities (draw before glyphs, allow foreground overrides).

### 2025-09-27 – OSC/DCS wiring & palette overrides
- Consumed expanded `TerminalAttributes` (italic, underline, faint, inverse, strikethrough) and cached palette updates for OSC 4/104 and truecolour writes.
- Added diagnostics for OSC/DCS/SOS payloads while avoiding unnecessary repaints; Vitest coverage now asserts palette and styling pipelines.

### Early scaffolding (undated)
- Exported public renderer contract with theme/metrics/lifecycle types from `src/index.ts`.
- Stood up Vitest + node-canvas + pixelmatch harness with initial smoke tests and artifact emission plan.
- Documented feature targets (glyph pipeline, performance, accessibility) to guide forthcoming implementations.
