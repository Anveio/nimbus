# WebGL Renderer Design

0) Executive Summary

We will implement a tile‑based, atlas‑driven, cached composition renderer that:

Caches the composed terminal frame in an offscreen texture (“content surface”).

Renders only dirty tiles (regions of cells that changed).

Scrolls via GPU bitblt (copy old content with an offset) and redraws only newly exposed lines.

Presents in one draw call (one quad), avoiding full-screen redraws.

Rasterizes glyphs on demand into glyph atlases, keyed at the grapheme cluster level (handles emoji/ZWJ/combining).

Supports multiple font sizes via per‑size atlases and an epoch invalidation model.

This design minimizes CPU and GPU work in the steady state and bounds cost during bursts (output floods, scroll storms).

1) Goals / Non‑Goals / Perf Targets

## Goals

Smooth rendering for typical terminal sizes (e.g., 200×60 up to 300×100 cells) at high DPI.

O(tiles_touched) work per frame; avoid O(total_cells).

GPU‑accelerated scrolls; redraw only newly visible rows.

Clean font pipeline: URL → FontFace → on‑demand glyph rasterization → atlas.

WebGL2 first‑class, WebGL1 fallback (with ANGLE_instanced_arrays).

## Non‑Goals (initial phase)

Complex text shaping/RTL (optional extension); we’ll handle grapheme clusters correctly and cache them as atoms.

Shader effects beyond outlines/underline/selection (keep shaders simple and fast).

## Performance Targets (engineering budgets)

Frame composition:

Present: 1 draw call.

Scroll: 1 fullscreen copy + ≤ (#tiles in newly exposed rows) draws.

Typical keystroke/PTY burst: ≤ 4 dirty tiles → ≤ 4 draw calls into content surface.

CPU: Damage tracking + bin‑packing + buffer updates per dirty tile should be bounded and independent of viewport size.

Uploads: Glyph atlas texSubImage2D calls batched, target ≤ 16 uploads per frame under worst-case glyph miss storms.

2) High‑Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ TerminalModel (grid, scrollback, ring buffers)                    │
│  - Cell[] rows; ring buffer for O(1) scroll                       │
│  - Grapheme segmentation + wcwidth                                │
└───────────────▲───────────────────────────────────────┬───────────┘
                │                                       │
         writes/scrolls                           font query
                │                                       │
┌───────────────┴───────────────┐               ┌────────▼─────────┐
│ DamageTracker (tiles)         │               │ FontSystem        │
│  - tile dirty flags           │               │  - FontFace load  │
│  - scrollLines accumulator    │               │  - metrics        │
│  - newly-exposed-lines set    │               │  - GlyphAtlas     │
└───────────────▲───────────────┘               │  - rasterizer     │
                │                               └────────▲──────────┘
                │ atlas lookups + glyph miss           │ glyph bitmaps
                │                                       │
         ┌──────┴───────────────────────────────────────┴────────────┐
         │ Renderer                                                  │
         │  - Content FBO ping/pong (T0/T1)                          │
         │  - Per-tile VAOs/VBOs for instances                       │
         │  - Background grid texture (cols×rows RGBA)               │
         │  - Overlays (cursor/selection/IME)                        │
         └───────────────▲───────────────────────────────────────────┘
                         │
                    Scheduler (RAF only when work exists)
```

Key pattern: *Mutate a cached picture in place rather than re‑drawing the world.*

3) Core Data Structures & APIs
3.1 Cell model (TypeScript sketch)

```typescript
type RGBA = { r: number; g: number; b: number; a: number }; // 0..255

type Cell = {
  grapheme: string;         // already segmented grapheme cluster
  width: 1 | 2;             // result of wcwidth-like function
  fg: RGBA | number;        // truecolor or palette index
  bg: RGBA | number;
  style: number;            // bitflags: bold/italic/underline/etc.
  glyphKey?: number;        // handle into GlyphMeta table (filled lazily)
  continuation?: boolean;   // marks trailing half of width=2 glyphs
};
```

3.2 Tiling

Fixed grid partitioned into tiles (default 32×32 cells):

Tradeoff: smaller tiles → finer invalidation, more draw calls; larger tiles → fewer draws, more overdraw. 32×32 is a good middle ground. For 200×60, it’s ~14 tiles (7×2); for 300×100, ~40 tiles (10×4).

Each tile keeps:

```typescript
type Tile = {
  col0: number; row0: number; // top-left cell coordinates
  cols: number; rows: number;
  dirty: boolean;
  vao: WebGLVertexArrayObject | null;
  vbo: WebGLBuffer | null;    // instance attributes for *this tile*
  instanceCount: number;      // equals tile.cols * tile.rows
  dprRectPx: { x: number; y: number; w: number; h: number }; // framebuffer space
};
```

Design choice: Per‑tile VAO/VBO (default).

Pros: Simple to draw subsets (no baseInstance in WebGL), isolates updates, keeps state changes local.

Cons: More objects, but counts remain small.

Alternative (advanced): Single global instance buffer ordered by tile + rebind attribute pointers per draw. Slightly fewer objects, more pointer churn; keep as an optimization toggle.

3.3 Damage tracker

```typescript
type Damage = {
  tilesDirty: Set<number>;     // tile indices
  scrollLines: number;         // positive=up, negative=down
  exposeRows: Set<number>;     // rows newly exposed after scroll
  overlayChanged: boolean;
  hasWork(): boolean;
  clear(): void;
};
```

Atlas pages: 2048–4096 RGBA8 textures, shelf/skyline packer, LRU eviction optional.

Meta storage to shader:

Default (WebGL1/2 compatible): pack UVs + bearings + style as per‑instance attributes in the tile VBO.

Optional (WebGL2): store glyph meta in a 2D metadata texture and index via texelFetch using glyphIndex attribute; reduces VBO size at the cost of an extra texture fetch.

4) Rendering Pipeline
4.1 Buffers & state

Content surfaces: two FBO‑attached textures T0, T1 sized to viewportPx * dpr.

Background grid texture: cols × rows RGBA8 storing per‑cell bg color. Updated via texSubImage2D on bg changes.

Per‑tile VAO/VBO: Instance attributes include at minimum:

aCellPos: u16x2 (cell coordinates inside viewport)

aUV: f16x4 (or two normalized UNSIGNED_SHORT → 4 bytes)

aBearing: i16x2 (px offsets)

aFG: u8x4, aBG: u8x4

aStyle: u16

aPage: u16 (atlas page index; switch texture by page or encode into draw buckets)

Packing tradeoffs:

Use normalized integers to reduce bandwidth: UNSIGNED_SHORT for UVs, BYTE for colors, SHORT for bearings.

Prefer tight structs to keep per‑tile instance buffer small (< 64 bytes/instance).

4.2 Passes per frame

Scroll bitblt (if any): bind T1 FBO, draw a full‑screen quad sampling from T0 with a v‑offset = scrollLines × cellPx.y (in pixels). Swap T0↔T1.

Tiles pass: for each dirty tile:

gl.scissor() to tile rect in framebuffer pixels.

Bind per‑tile VAO (preconfigured attribute pointers).

Bind needed atlas page textures (if multiple, bucket tiles by page to minimize binds).

gl.drawArraysInstanced(TRIANGLES, 0, 6, tile.instanceCount).

Background pass (option A):

One full‑screen draw reading bgTexture(cols×rows):

```glsl
ivec2 cell = ivec2(floor(gl_FragCoord.xy / uCellPx));
vec4 bg = texelFetch(uBGTex, cell, 0);
outColor = bg;
```

Tradeoff: Always-on cheap pass (1 draw) vs. merging bg into tile redraws (slightly fewer passes but adds per‑tile work). Start with single pass: simpler, predictable.

Overlays: cursor, selection, IME composition:

Either tiny overlay FBO or immediate draw on the default framebuffer after content quad.

Present: Bind the default framebuffer, draw one quad sampling T0.

Order variant: background first, then text into T0 (using blending), then overlays. Alternatively, draw background into T0 only under dirty tiles; both are viable—choose the simpler single full‑screen bg pass unless profiling shows it dominates.

5) Update Loop & Scheduler

No free‑running RAF. Only request a frame if damage.hasWork() == true.

Coalesce PTY writes and scrolls within one tick.

Cursor blink: flip a small overlayChanged flag; avoid touching content unless the cursor’s shape modifies underlying text.

Pseudocode

```typescript
function frame() {
  if (!damage.hasWork()) return;

  // 1) Handle scrolls first
  if (damage.scrollLines !== 0) {
    bitbltWithOffset(T0, T1, damage.scrollLines * cellPx.y);
    swap(T0, T1);
    markExposedRows(damage.scrollLines);  // fill damage.exposeRows
    markTilesContainingRowsDirty(damage.exposeRows);
    damage.scrollLines = 0;
  }

  // 2) Redraw dirty tiles into T0
  bindFBO(T0);
  for (const tileIdx of damage.tilesDirty) {
    const tile = tiles[tileIdx];
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(tile.dprRectPx.x, tile.dprRectPx.y, tile.dprRectPx.w, tile.dprRectPx.h);
    bindVAO(tile.vao);
    bindAtlasPagesForTile(tile); // bind uAtlas0..uAtlasN as needed
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, tile.instanceCount);
    tile.dirty = false;
  }
  gl.disable(gl.SCISSOR_TEST);

  // 3) Overlays → default framebuffer
  present(T0);
  drawOverlays(overlayState);

  damage.clear();
}
```
6) Font & Glyph Atlas Pipeline (URL → Atlas)
6.1 Loading fonts from URL (CORS safe)

Fetch ArrayBuffer and instantiate new FontFace(family, buffer, { weight, style }).

Add to FontFaceSet (document.fonts on main thread; self.fonts if supported in worker).

Edge case: If worker lacks self.fonts, do font loading on the main thread, then notify the worker before rasterization.

6.2 Metrics per (family, size)

Measure via OffscreenCanvas 2D: ctx.measureText('█') (fallback ‘M’) to get width, actualBoundingBoxAscent/Descent.

Compute cellW, cellH, baseline, snap to integer device pixels to prevent shimmer.

Store metrics keyed by variant.

6.3 Rasterization & packing

Grapheme clusters as cache keys (normalize NFC but preserve VS/ZWJ).

For a cache miss:

Create OffscreenCanvas sized ceil(cellW * widthCells * dpr) × ceil(cellH * dpr).

Draw cluster at baseline; extract tight bbox via measureText boxes.

Convert to ImageBitmap (fast upload path).

Bin‑pack into current atlas page; if none fits, allocate a new page.

Upload via gl.texSubImage2D (set UNPACK_ALIGNMENT=1).

Record UVs/bearings/advanceCells to AtlasGlyph.

Color fonts (emoji, COLR/CPAL): handled automatically by Canvas; the bitmap is RGBA premultiplied—enable premultiplied alpha in pixel store if needed.

Filtering: start with NEAREST to avoid glyph bleeding without edge extrusion. If switching to LINEAR, add 1–2 px padding/extrusion around packed glyphs.

6.4 Multiple sizes & stacks

Maintain separate atlases per size; switching size calls bumpEpoch() and lazily repopulates misses.

Support font stacks by passing a CSS font list into ctx.font, e.g., "JetBrains Mono", "Noto Emoji", "Noto Sans CJK"; key the cache by the stack string to ensure consistency.

6.5 API (sketch)

```typescript
class GlyphPipeline {
  async loadFontFromURL(family: string, url: string, opts?: { weight?: string|number; style?: 'normal'|'italic' }): Promise<void>;
  async setVariant(familyOrStack: string, sizePx: number, weight?: string|number, style?: 'normal'|'italic'): Promise<void>;
  async ensureGlyph(cluster: string): Promise<AtlasGlyph>;  // creates/upload if missing
  metrics(): FontMetrics;                                   // cellW, cellH, baseline
  atlasTexture(pageIdx: number): WebGLTexture;              // for binding
}
```
7) Renderer ↔ Model Integration
7.1 Grid updates

PTY write → update Cell values; mark affected tiles dirty (including width=2 continuation handling).

When bg changes, update the bg texture with texSubImage2D at (col,row); optionally mark the tile dirty if bg is drawn in tiles pass rather than bg pass.

7.2 Scroll

Model uses a row ring buffer; on scroll, adjust head index instead of moving memory.

Renderer gets scrollLines → performs GPU bitblt (offset copy), marks newly exposed rows as dirty and (optionally) pre-fills their instance buffers from the model.

8) Shaders (reference sketches)
8.1 Vertex (instanced quads)

Build a unit quad (two triangles) expanded per instance by cellPx and glyph bearing/size.

Snap to integer device pixels to avoid shimmering.



```glsl
// Attributes (per-instance)
in vec2  aCellPos;    // cell coords (col,row)
in vec4  aUV;         // u0,v0,u1,v1
in vec2  aBearingPx;  // x,y offset in px from cell top-left
in vec4  aFG;         // normalized 0..1
in vec4  aBG;         // optional (if needed here)
in uint  aStyle;
in uint  aAtlasPage;  // if binding via array texture or atlas pages

uniform vec2 uCellPx;         // cell width/height in px
uniform vec2 uViewportPx;     // framebuffer size
uniform mat3 uProj;           // pixel->NDC
uniform float uDPR;           // device pixel ratio

out vec2 vUV;
out vec4 vFG;
out uint vStyle;

const vec2 QUAD_POS[6] = vec2[6](
  vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
  vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0)
);

void main() {
  vec2 basePx = aCellPos * uCellPx + aBearingPx;
  vec2 posPx  = basePx + QUAD_POS[gl_VertexID] * uCellPx; // conservative quad; or use glyphW/H if tracked
  // snap to integer px
  posPx = floor(posPx * uDPR + 0.5) / uDPR;
  vec3 ndc = uProj * vec3(posPx, 1.0);
  gl_Position = vec4(ndc.xy, 0.0, 1.0);

  vec2 uv = mix(aUV.xy, aUV.zw, QUAD_POS[gl_VertexID]);
  vUV = uv;
  vFG = aFG;
  vStyle = aStyle;
}
```
8.2 Fragment (text)


```glsl
precision mediump float;
uniform sampler2D uAtlas;  // bind correct atlas page before draw
in vec2 vUV;
in vec4 vFG;
out vec4 outColor;
void main() {
  vec4 s = texture(uAtlas, vUV); // premultiplied alpha expected
  // If glyphs are monochrome baked as alpha only, multiply by vFG
  outColor = vec4(vFG.rgb, 1.0) * s.a; // or straight sample if color glyph bitmaps
}
```
8.3 Background pass (full-screen)
```glsl
// Fragment
uniform sampler2D uBG;        // cols×rows RGBA8
uniform vec2 uCellPx;
uniform vec2 uViewportPx;
out vec4 outColor;

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCellPx);
  vec2 uv = (cell + 0.5) / textureSize(uBG, 0);
  outColor = texture(uBG, uv);
}
```
9) WebGL1/2 Compatibility

Instancing: Use ANGLE_instanced_arrays on WebGL1. Feature‑detect and fall back to per‑glyph quads only if absolutely necessary (perf hit). Prefer WebGL2 baseline for production.

Vertex texture fetch: Do not rely on it for metadata in WebGL1. Default design packs meta as attributes.

Blitting: WebGL1 lacks blitFramebuffer; use fullscreen textured quad copy (works on both).

VAO: Use OES_vertex_array_object on WebGL1; otherwise, bind attributes per draw.

Texture formats: Stick to RGBA8; R8 is WebGL2‑only (possible optimization later).

10) Concurrency & Threading

Run WebGL in a Worker with OffscreenCanvas (where supported) to isolate the main thread.

Message protocol (postMessage, structured clone):

Init({ canvas, dpr, cols, rows })

FontLoaded({ stack })

VariantChange({ stack, sizePx, weight, style })

CellsWrite({ updates: Array<{x,y,cell}> }) // batched per tile

Scroll({ lines })

Resize({ cols, rows, viewportPx, dpr })

Overlay({ cursor, selection, ime })

Use SharedArrayBuffer ring buffers (optional) to stream PTY output; batch per tile/row.

11) Memory Management & Resource Lifecycles

Atlas pages: LRU evict least recent glyphs under pressure (track access epoch). Provide a hard cap (e.g., 3–5 pages per size).

Variant switch: bump epoch, keep pages until idle GC or hard cap; lazily repopulate misses.

Resize/DPR change: reallocate T0/T1 to new framebuffer size; recompute per‑tile dprRectPx.

Cleanup: destroy VAOs/VBOs/FBOs/textures on teardown; free ImageBitmaps after upload (.close()).

12) Testing & Profiling Plan
12.1 Correctness suites

Grapheme coverage: combining marks, ZWJ emoji sequences, CJK width=2, variation selectors.

Scroll storms: line flood (1000× scroll), verify only exposed rows redraw.

Resize/DPI: dynamic zoom in/out; ensure crisp alignment (no shimmer).

Font stack fallback: enforce glyph fallback to secondary fonts; verify atlas keys remain consistent.

12.2 Performance harness

Metrics to emit (per frame & rolling windows):

Dirty tile count, draw calls, glyph atlas hits/misses, texSubImage2D count/bytes.

Frame time breakdown: damage, rasterize+pack, uploads, draws, present.

Scroll bitblt time & exposed rows redraw count.

Targets: keep steady‑state frames ≈ 1–3 draws (bg + present); cap uploads/bandwidth in glyph storms via batching (e.g., ≤ N glyphs/frame, configurable).

GPU capture: presets for Chrome Tracing / WebGL Inspector / Spector.js.

13) Failure Modes & Mitigations

No WebGL / missing extensions:

Fallback to Canvas2D renderer that uses the same atlas & damage model (still supports GPU scroll via drawImage copy).

CORS font fetch fails:

Use system fonts; log; surface telemetry. Document CDN headers (font/woff2, Access-Control-Allow-Origin).

Atlas overflow:

Evict via LRU or allocate a new page up to cap; under heavy emoji storms, batch uploads and soft‑limit per frame.

Precision/bleeding (with LINEAR filters):

Add padding/extrusion; default to NEAREST until validated.

14) Implementation Roadmap (sequence of deliverables)

Static renderer skeleton

WebGL2 context, offscreen FBO T0, present quad, single atlas, single size.

Per‑tile VAO/VBO populated once; draw full screen (no damage yet).

Damage tracking + scissor per tile

Mark tiles on cell writes; draw only dirty tiles into T0.

GPU scroll

Ping‑pong T0/T1, offset copy, mark & redraw exposed rows.

Background grid texture pass

cols×rows RGBA texture; update via texSubImage2D; single full‑screen pass.

Glyph pipeline (URL→FontFace→atlas)

Metrics, rasterization, bin‑packing, texSubImage2D uploads, epoch model.

Overlays (cursor, selection, IME)

Overlay draw after present; avoid touching content for blink.

WebGL1 fallback

ANGLE instancing, OES VAO; metadata as attributes.

Worker move

OffscreenCanvas in worker, message protocol, batch writes.

Telemetry & limits

Emit metrics; implement LRU cap; frame upload budget.

Polish & hardening

DPI/zoom stability; emoji/complex graphemes; selection performance; memory audits.

15) Acceptance Criteria (per milestone)

Scroll: For N-line scroll, only newly exposed rows’ tiles are redrawn; preserved region is copied via GPU; visual diff stable.

Dirty writes: Single‑cell writes touch ≤ 1 tile and cause ≤ 1 tile draw (plus present).

Atlas: First encounter of a new grapheme creates exactly one glyph upload; subsequent draws are cache hits.

Zoom/variant change: No global re‑rasterization; glyphs repopulate lazily; interactions remain responsive.

DPI: No subpixel shimmer during typing or scrolling at DPR 1.0–3.0.

Fallback: On forced WebGL1, functional parity with acceptable performance for typical viewports.

Telemetry: Counters exposed; regressions caught in CI perf tests.

16) Key Tradeoffs (explicit)

Per‑tile VAOs/VBOs vs one global buffer

Chosen: per‑tile. Reduces draw complexity; aligns with scissor; costs extra objects (small count).

Alternative: one buffer, rebind pointers per draw (fewer objects, more pointer churn). Consider later if profiling shows VAO count issues.

Background in a dedicated pass vs merged

Chosen: dedicated pass (1 draw, simple updates via texSubImage2D).

Alternative: merge into tile rendering (fewer passes, more per‑tile work). Revisit if fill‑rate becomes a bottleneck.

UV/bearing as attributes vs metadata texture

Chosen default: attributes (WebGL1/2 compatible, even on devices with poor vertex texture fetch).

Alternative (WebGL2): metadata texture with texelFetch to shrink VBOs; use behind a feature flag.

Filtering

Chosen: NEAREST to avoid bleeding without padding; switch to LINEAR + extrusion later if required.

Shaping

Chosen: grapheme cluster rasterization (covers combining/ZWJ).

Alternative: full HarfBuzz shaping (WASM) gated by feature flag for ligatures/RTL.

17) Integration Details & Edge Cases

Double‑width glyphs: mark trailing cell as continuation=true; renderer does not draw continuation instances. Ensure hit‑testing/selection respects width=2.

Selection: store ranges in cell coords; either tint via background pass (preferred: update bg texels for selected cells) or overlay translucent quads. Choose whichever yields fewer updates for your UX.

Underline/strikethrough: implement in fragment shader with simple y‑band test using style flags; avoids additional geometry.

Cursor: draw as overlay rect; blink via a timer toggling overlayChanged only.

Resizing: update cols, rows, re‑tile, reallocate T0/T1, recompute dprRectPx, rebuild per‑tile instance buffers once.

Security: serve fonts with correct MIME (font/woff2) + CORS; sanitize URLs; do not allow arbitrary data URLs unless trusted.

18) Code Interfaces (hand‑off level)
18.1 Renderer API
```typescript
interface TerminalRenderer {
  init(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { dpr: number; cols: number; rows: number }): Promise<void>;
  setVariant(stack: string, sizePx: number, weight?: string|number, style?: 'normal'|'italic'): Promise<void>;
  writeCells(batch: Array<{ x: number; y: number; cell: Cell }>): void;  // marks tiles dirty
  scroll(lines: number): void;                                           // accumulates, handled next frame
  setBackgroundCells(batch: Array<{ x: number; y: number; bg: RGBA | number }>): void; // texSubImage2D updates
  setViewport(px: { w: number; h: number }, dpr: number, cols: number, rows: number): void;
  setOverlay(state: OverlayState): void;
  frame(): void; // schedules RAF if needed; no free-run loop
  destroy(): void;
}
```
18.2 Font/Glyph API (from §6.5)

As defined; returns AtlasGlyph with UVs/bearings/advance.

19) Example Workflows
19.1 PTY output (“ls -l” flood)

Model appends text across several rows.

DamageTracker marks affected tiles dirty.

On frame: redraw only those tiles into T0; present.

Atlas misses batched: a few texSubImage2D calls before draws.

19.2 Scroll up 20 lines

Model increments ring buffer head by 20.

Renderer: bitblt T0→T1 with +20*cellPx.y offset, swap; mark top 20 rows tiles dirty; redraw those tiles; present.

19.3 Zoom from 14px → 16px

setVariant(..., 16); epoch++ ; metrics recomputed; cellPx updated.

On demand, glyphs repopulate into the 16px atlas as they appear.

20) Future Enhancements (behind flags)

WebGPU backend (same tiling/atlas model; simpler blits, storage buffers).

SDF/MSDF glyphs for arbitrary scaling and crisp outlines (trade memory for quality).

Metadata texture (WebGL2 path) to reduce VBO size and accelerate tile updates.

Ligatures/RTL shaping via HarfBuzz WASM; cache shaped clusters identically.

Appendix A — Practical Constants (initial defaults)

Tile size: 32×32 cells.

Atlas page: 2048×2048 RGBA8, NEAREST, CLAMP_TO_EDGE.

Max atlas pages per size: 3 (configurable).

Glyph upload budget per frame: ≤ 16 (configurable).

UNPACK alignment: 1; premultiplied alpha on for ImageBitmap.

Appendix B — Scissor & DPR math sanity

Convert tile cell rect → framebuffer pixels:
xPx = floor(col0 * cellW * dpr), wPx = ceil(cols * cellW * dpr), similarly for y/h.

Snap vertex positions to integer device pixels: floor(posPx*dpr+0.5)/dpr.

Appendix C — wcwidth & graphemes

Use Intl.Segmenter('grapheme') when available.

Replace regex stub with a spec‑conformant wcwidth table.

Preserve VS/ZWJ in keys; NFC normalize else.