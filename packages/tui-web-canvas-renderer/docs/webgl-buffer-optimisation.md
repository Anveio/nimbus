# WebGL Renderer Buffer Optimisation Plan

**Owner:** `@mana-ssh/tui-web-canvas-renderer`

**Last updated:** 2025-10-07

## 1. Context

The WebGL backend currently mirrors the CPU renderer by rebuilding full-frame
geometry on every repaint. Each call to `renderSnapshot()` walks the complete
terminal buffer, appends vertex data into fresh arrays, and uploads them via
`gl.bufferData` with `DYNAMIC_DRAW` hints (`packages/tui-web-canvas-renderer/src/backends/gpu-webgl.ts:862`).
While this keeps the implementation simple, it defeats the purpose of using the
GPU: CPU-side allocations dominate frame time, and we cannot amortise the cost of
dirty-region rendering. There is no instrumentation to tell whether a frame was
CPU-bound or GPU-bound, making regression detection difficult.

## 2. Goals

- Preserve visual parity with the CPU renderer while reducing CPU overhead for
  WebGL frames.
- Reuse GPU buffers between frames to avoid large per-frame allocations and
  driver synchronisation.
- Consume interpreter deltas incrementally so we only touch geometry for changed
  cells.
- Surface diagnostics that quantify the effect of these optimisations
  (processed cell count, bytes uploaded, diff coverage) and wire them through
  existing telemetry hooks.
- Keep the GPU backend contract stable so the React layer and tests require no
  immediate changes.

## 3. Non-Goals

- Introducing instanced rendering, compute passes, or shader rewrites in this
  milestone.
- Implementing partial glyph atlas uploads; the atlas can remain a full texture
  update until the buffer work is proven.
- Refactoring the CPU backend. Lessons learned can be back-ported later.

## 4. Proposed Architecture

### 4.1 Persistent Buffer Pools

**Problem:** `renderSnapshot()` allocates new `Float32Array`s every frame, then
calls `gl.bufferData` which reallocates GPU memory and stalls the pipeline.

**Approach:**

1. Allocate typed arrays sized to the viewport during `sync()`/`resize()`.
   - Maintain `geometry.background`, `geometry.glyph`, and optional
     `geometry.overlay` buffers with precomputed capacities.
   - Expose helper `ensureCapacity(buffer, requiredVertices)` that grows the
     backing array when the terminal size increases. Buffers remain oversized for
     a grace window (for example five idle minutes); a periodic sweep shrinks them
     back to the active viewport size so long-lived sessions do not pin large
     allocations indefinitely. Shrinking triggers outside of active frames: we
     fence pending diff writes, allocate new arrays + GL buffers, perform a full
     snapshot rebuild into the fresh storage, then swap references atomically so
     the tracker never writes into stale memory.
2. Replace `gl.bufferData(..., Float32Array, DYNAMIC_DRAW)` with
   `gl.bufferSubData`, writing only the populated portion of the persistent array.
3. Track current vertex counts so subsequent frames can clear by setting a write
   pointer to zero instead of reallocating.

**Code touchpoints:**

- `buildFrameGeometry` will mutate preallocated arrays rather than returning new
  ones. Signature change to accept buffers + write offsets, plus a map from
  logical cell indices to vertex ranges so multi-column glyph spans can be
  rewritten safely. Bulk operations (scroll memmove, buffer shrink) update this
  map alongside the geometry copy; unit tests will cover these maintenance paths
  to avoid stale offsets.
- `renderSnapshot` only binds buffers once per frame; upload calls pass
  `subarray(0, vertexCount * components)`.
- `resize()` reinitialises capacities and clears caches.

### 4.2 Diff-Aware Geometry Construction

**Problem:** Every call to `applyUpdates()` sets `requiresRepaint = true` and
triggers a full rebuild even if only a handful of cells changed. This limits the
benefit of persistent buffers.

**Approach:**

1. Maintain a `DirtyRegionTracker` that records affected rows/columns based on
   `TerminalUpdate` entries (cells, scroll, clear, palette, selection, etc.). The
   tracker collapses wide glyphs and surrogate pairs into a single invalidation
   span and explicitly marks the trailing column for every `wcwidth` > 1 glyph.
   Zero-width combiners inherit the preceding cell’s span so the paired geometry
   stays in sync.
2. Extend `buildFrameGeometry` to accept one of two modes:
   - **Full frame:** used on initial `sync()`, `resize()`, or global state
     changes (palette/theme swaps, reverse video toggles).
   - **Row batches:** iterate only the dirty rows, recomputing geometry for those
     cells and leaving untouched regions intact in the buffers.
3. For background quads, compute array offsets as
   `(rowIndex * columns + columnIndex) * VERTICES_PER_CELL` so we can overwrite
   the correct segments in-place. When the dirty tracker surfaces a multi-cell
   glyph, we use the vertex-range map from step 1 to overwrite the entire span.
4. After each draw, clear the tracker. Selections and cursor updates mark the
   affected rows to ensure overlays stay consistent.

**Considerations:**

- Structural edits (`insertChars`, `deleteChars`, tab expansion) shift remaining
  cells in a row. The tracker widens the dirty range to the row tail for these
  updates so downstream geometry is re-emitted. Longer term we can mirror the
  interpreter’s compaction logic for finer-grained updates.
- Scroll events shift large ranges; support two strategies:
  - `memmove` geometry slices within each buffer when the scroll delta is small.
    We introduce stride helpers per layer (background, glyph positions, texture
    coordinates, colours) and guard overlapping copies by switching to
    back-to-front iteration or triggering a full rebuild. Unit tests will cover
    representative copy permutations to catch stride regressions.
  - Fallback to full rebuild when the scroll region exceeds a threshold or when
    stride analysis flags unsafe overlap.
- Palette changes require touching all cells using the affected colour. For the
  initial iteration we can mark all rows dirty; optimisation can follow later.

### 4.3 Diagnostics & Instrumentation

- Extend `CanvasRendererDiagnostics` with:
  - `gpuCellsProcessed` – number of cells visited during geometry build.
  - `gpuBytesUploaded` – total bytes passed through `bufferSubData` this frame.
  - `gpuDirtyRegionCoverage` – ratio of dirty cells to total cells (0–1).
  - `gpuOverlayBytesUploaded` – bytes written to overlay buffers for cursor /
    selection rendering in the current frame.
- Update `updateDiagnostics` to accept these metrics and expose them alongside
  existing timing & draw counts.
- Emit console warnings (guarded behind `options.verboseDiagnostics`) when a
  frame falls back to a full rebuild, aiding test harness analysis.
- Overlay-only updates (selection, cursor overlays) are counted separately: if a
  frame touches only overlay geometry, `gpuCellsProcessed` stays at zero while
  `gpuOverlayBytesUploaded` records activity so telemetry still reflects the
  change. Sampling matches the main metrics (per frame).
- Base diagnostics remain always-on and cheap; hosts may disable verbose logging
  but core metrics are collected for every frame to keep analytics consistent.

### 4.4 Testing Strategy

1. **Unit tests (Vitest):**
   - Mock `DirtyRegionTracker` input sequences and assert buffer offsets are
     patched rather than replaced.
   - Validate diagnostic counters for sparse vs. full updates.
2. **Pixel Regression:**
   - Reuse existing CPU/WebGL image baselines to ensure visual parity after the
     refactor (no expected diff).
3. **Performance microbenchmarks (manual for now):**
   - Add a debug script that simulates a 120fps dirty cell stream and reports
     ms/frame before vs. after the change. Results will feed into the design
     memory bank.

## 5. Rollout Plan

1. Land persistent buffer support with full-frame rebuilds (no diff tracker yet)
   to validate buffer management and diagnostics counters.
2. Introduce the dirty-region tracker + partial rebuild logic guarded by a
   feature flag (`enableGpuDiffRendering`). Default to `false`, enable in
   internal builds after confidence grows.
3. Remove the feature flag once pixel and performance coverage stabilise.

## 6. Open Questions

- How should we serialise dirty rectangles when selection spans multiple rows
  with palette overrides? A mixed strategy (row batch + overlay refresh) may be
  required.
- Do we want to expose diagnostics upstream via the React layer immediately, or
  keep them internal until the data stabilises?
- At what threshold should scroll events trigger a full rebuild vs. in-place
  geometry shifts? A heuristic based on viewport size is proposed but not yet
  final.

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Incorrect offset calculations when overwriting buffers | Visual glitches or GPU errors | Build offset helpers with exhaustive unit tests; add assertions during development builds. |
| Dirty tracker misses updates (e.g. palette or selection changes) | Stale pixels on screen | Centralise dirty marking in `applyUpdates`, default to full rebuild on unknown update types. |
| Diagnostics overhead negates performance gains | Reduced frame rate | Keep counters lightweight; allow sampling at configurable intervals. |

## 8. Follow-Up

- Update `renderer-test-spec.md` once pixel/diagnostic tests land, marking the
  optimisation scenarios as ✅.
- Document the final behaviour in the main GPU design doc after implementation
  (promote this plan from proposal to completed milestone).
