# GPU Renderer Design (WebGL Backend)

**Owners:** `@mana-ssh/tui-web-canvas-renderer`

**Last updated:** 2025-10-01

## 1. Problem Statement

`@mana-ssh/tui-web-canvas-renderer` renders terminal frames with the Canvas 2D API today. While this is reliable, CPU rasterisation becomes a bottleneck for high-frequency workloads (rapid palette swaps, selection animation, large dirty regions) and limits our ability to experiment with richer effects (glyph composition, inline graphics, diagnostics overlays). A GPU-backed renderer lets us keep parity with modern terminals, push towards higher frame rates, and open the door to future WebGL/WebGPU work.

## 2. Goals

- Provide a WebGL renderer selectable at runtime while keeping the CPU renderer as the default.
- Share as much logic as possible across backends (colour resolution, selection geometry, diagnostics) so behaviour stays in sync.
- Match the CPU renderer’s output (within our pixel-diff tolerances) for glyphs, selections, palette overrides, cursors, underline/strikethrough, and faint/bold attributes.
- Surface GPU-specific telemetry (frame duration, draw call counts, atlas uploads) through the existing diagnostics structure.
- Keep the public API unchanged: hosts opt in by supplying `backend: { type: 'gpu-webgl' }` when calling `createCanvasRenderer`.

## 3. Non-Goals

- Shipping a WebGPU backend in this cycle. WebGL now, WebGPU tracked separately once the abstraction layer stabilises.
- Rewriting host frameworks (`@mana-ssh/tui-react`, apps) beyond wiring an optional backend selector.
- Implementing Sixel/kitty graphics immediately. The pipeline is structured to support them later.

## 4. Constraints & Assumptions

- Target browsers: latest Chromium, Firefox, Safari. Minimum feature set: WebGL1 + `ANGLE_instanced_arrays`, `OES_vertex_array_object`, `OES_texture_float`. WebGL2 is preferred and used when available.
- Glyph rendering must respect interpreter-provided metrics (device pixel ratio, baseline, cell width/height) and theme colours.
- Implementation stays pure TypeScript; no Effect runtime. Node tests rely on the CPU renderer until headless WebGL stabilises.

## 5. Current Architecture Snapshot

- `createCanvasRenderer` now delegates to a backend registry. CPU remains the default; GPU is opt-in via `backend` configuration.
- Shared utilities under `src/internal/` provide colour resolution, layout sizing, a glyph atlas, and colour caching.
- Diagnostics grew two optional fields (`gpuFrameDurationMs`, `gpuDrawCallCount`) so callers can observe GPU workload characteristics.

## 6. Implementation Overview

### 6.1 Backend Selection API

- `CanvasRendererOptions.backend` accepts `{ type: 'gpu-webgl', fallback: 'prefer-gpu' | 'require-gpu' | 'cpu-only' }`. The factory honours the fallback policy and gracefully falls back to the CPU renderer when allowed.
- Backend selection now routes through a registry of `RendererBackendProvider`s (CPU + WebGL today). Each provider owns `probe`, `normalizeConfig`, and `create` hooks so we can add WebGPU without rewriting callers.
- `CanvasLike` exposes a `'webgpu'` context entry point and `WebgpuBackendConfig`/probe scaffolding so future work can request adapters/devices while staying within the shared contract.
- `detectPreferredBackend()` delegates to the registry, probing WebGL support and returning the appropriate configuration so hosts can easily opt in. Additional providers will plug in without changing the public API.
- The `<Terminal />` demo app reads `?renderer=webgl`/`?renderer=cpu` query parameters and passes a memoised renderer factory down to `@mana-ssh/tui-react`.

### 6.2 Shared Core Utilities

- `colors.ts` centralises palette resolution, inverse handling, faint/hidden attributes, and selection overrides.
- `glyph-atlas.ts` rasterises glyphs (bold/italic aware) into a padded atlas using a 2D canvas or `OffscreenCanvas`. Each glyph returns UV coordinates for use in the GPU pass.
- `color-cache.ts` normalises CSS colour strings to `[0, 1]` tuples for fast buffer writes.
- `layout.ts` ensures the canvas backing store tracks the interpreter snapshot and device pixel ratio.

### 6.3 WebGL Rendering Pipeline

- We attempt WebGL2 first, falling back to WebGL1 with required extensions. Shader bundles exist for both profiles (`#version 300 es` with explicit attribute locations vs. classic `attribute/varying`).
- Each frame we walk the `TerminalState`, resolve colours, and emit:
  - Background quads: default theme, reverse video, palette overrides, selection highlights, cursor rectangles, underline/strikethrough decorations.
  - Glyph quads sampling the atlas texture with per-vertex colour (including faint alpha scaling).
- Two programs drive rendering:
  - **Background program:** solid colour triangles for backgrounds, selections, decorations, and cursor blocks.
  - **Glyph program:** samples the atlas texture, multiplies by per-vertex colour, and blends over the cleared background.
- Buffers are uploaded per frame using `gl.bufferData` (full rebuild for the initial milestone). Draw order: clear, backgrounds, glyphs. An overlay program exists for future custom cursor overlays.
- The DOM canvas is tagged with `data-mana-renderer-backend` so hosts/tests can detect which backend rendered the frame.

### 6.4 Cursor & Fallback Handling

- Built-in cursor shapes (block, underline, bar) render as additional quads using the theme colour/opacity.
- Custom `cursorOverlayStrategy` callbacks continue to work via the CPU backend while we design a GPU-friendly overlay API.
- Failures during context creation or shader compilation fall back to the CPU renderer unless the caller insists on `require-gpu`. Diagnostic structures capture the failure reason.

### 6.5 Edge Cases

- Headless Chromium (used by Playwright) rejects the production shaders without returning a useful info log. The dedicated WebGL E2E scenario is currently marked `test.fixme`; browsers that expose WebGL normally render via the GPU path.
- Geometry rebuilds are full-frame; dirty-region diffing, atlas eviction, overlay textures, and headless WebGL coverage remain on the roadmap.

## 7. Testing & Verification Strategy

- CPU unit tests continue to exercise the shared logic. GPU-specific unit coverage (e.g. via `headless-gl`) will be added once driver issues are resolved.
- Playwright exercises the CPU renderer end-to-end. The WebGL scenario documents the desired coverage but is paused via `test.fixme` pending reliable headless support.
- Diagnostics now expose GPU timing/draw counts so higher layers can assert performance and gather profiling data when the GPU backend is active.

## 8. Incremental Delivery Plan

1. **Phase 0 – Abstraction groundwork** *(completed)*
   - Extracted shared colour/layout helpers, moved the CPU renderer into `backends/cpu.ts`, and added backend selection plumbing.
2. **Phase 1 – WebGL MVP** *(completed)*
   - Implemented glyph atlas generation, full-frame geometry rebuilds, WebGL shaders/buffers, and CPU fallback with diagnostics.
3. **Phase 2 – Feature parity** *(in progress)*
   - Selection/cursor overlays render as native GPU quads; palette overrides and diagnostics wiring live alongside the CPU path.
   - Playwright GPU coverage remains parked until headless WebGL is stable.
4. **Phase 3 – Optimisation & Hardening** *(planned)*
   - Dirty-region batching, atlas eviction, custom cursor overlays, headless WebGL smoke tests, and richer profiling hooks.
5. **Phase 4 – WebGPU Exploration** *(planned)*
   - Implement a WebGPU provider (device negotiation, queue lifecycle, texture uploads) atop the registry scaffolding, reuse geometry buffers where possible, and update `detectPreferredBackend()` to juggle async probes + capability prioritisation.

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Headless browsers reject shaders | GPU backend unusable in CI | Expose clear diagnostics, fall back to CPU, revisit shaders or driver flags in future work. |
| Glyph atlas memory growth | Increased VRAM usage | Simple row allocator with padding today; atlas eviction/compaction planned. |
| Divergent rendering between backends | Visual regressions | Shared colour/geometry helpers keep logic aligned; diagnostics report draw metrics for comparison. |
| Manual resource management bugs | Context leaks or crashes | Explicit cleanup of buffers/programs/textures on `dispose` and error paths. |

## 10. Open Questions

- Should we prewarm the atlas with ASCII/line-drawing glyphs to reduce first-frame uploads?
- How should we expose custom cursor/overlay hooks in a GPU-friendly way?
- What telemetry should bubble up to allow hosts to decide when to enable GPU by default?

## 11. Documentation & Follow-up

- README and `renderer-test-spec.md` will be updated alongside future optimisation work.
- Track WebGPU exploration and headless WebGL support as separate ADRs once the current backend stabilises.
- Maintain the incremental optimisation roadmap in `webgl-buffer-optimisation.md` and reconcile its milestones once implemented.
