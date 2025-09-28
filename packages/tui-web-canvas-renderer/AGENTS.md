# @mana-ssh/tui-web-canvas-renderer – Agent Log

## Mission

Deliver a standalone, high-performance canvas renderer for the Mana SSH terminal stack. This package is responsible for taking the interpreter output from `@mana-ssh/vt` (screen buffer, cursor state, attributes) and drawing it into an HTML `<canvas>` element. It must track cursor/selection, handle resize events gracefully, and provide hooks so higher-level frameworks (React, vanilla JS, etc.) can embed the renderer in any web application.

## Design goals

- **Renderer-only responsibility** – no parser or interpreter logic. Consumers feed the renderer with terminal snapshots/updates.
- **Pluggable API** – expose a simple interface (`init`, `applyUpdates`, `resize`, `dispose`) so UI layers can orchestrate lifecycle without knowing about the drawing internals.
- **Performance-first** – leverage canvas 2D context (and GPU acceleration where available) to minimise DOM churn. Keep allocations low, batch draw calls, and provide dirty-region updates.
- **Robustness** – support dynamic resize, high-DPI displays, cursor inversion, theme changes, and fall back gracefully when palette entries are missing.
- **Extensibility** – act as the reference implementation for future renderers (SVG, WebGL, React Native). Document the renderer contract so new backends can be dropped in.

## Feature surface (target parity)

- **Rendering fidelity** – Unicode aware glyph pipeline (wide cells, combining marks, emoji), ANSI 16/256/truecolor, SGR attributes (bold, faint, italic, underline styles, blink, inverse, hidden, strikethrough), cursor that supports block/bar/underline shapes with opacity/blink, and selection overlays.
- **Fonts & layout** – configurable font stacks, size/line-height/letter-spacing, bold/italic fallbacks, high-DPI scaling, ligature toggle, optional font metrics caching, accurate reflow on resize, emoji/image fallbacks.
- **Graphics/media** – Sixel and inline image protocols (kitty/iTerm) as stretch goals, support for pixel art (braille, box drawing), optional WebGL acceleration path.
- **Color & theme** – dynamic palette swapping without flicker, cursor/selection theming, inverse rendering, theme transitions, background images or transparency for compositing.
- **Performance** – dirty-region batching, devicePixelRatio aware rendering, offscreen canvas support, frame timing diagnostics (draw call count, last frame duration), backpressure handling when updates flood.
- **Interaction** – text selection (block/column/word), clipboard hooks, mouse mode indicators, focus outlines, visual bell, hyperlink underline hover states.
- **Resilience** – graceful context loss recovery, caps for payloads (e.g. Sixel), defensive fallbacks for missing glyphs, lifecycle hooks (`dispose`) that tear down timers.
- **Accessibility & UX** – high-contrast mode, focus cues, screen-reader overlay compatibility, configurable cursor styling, ability to invert/tint for readability.
- **Integration hooks** – screenshot/export API, instrumentation callbacks, external theme updates, ability to surface renderer diagnostics to host UI.

## Testing + regression strategy

- **Reference fixtures** – store canonical terminal snapshots (JSON describing `TerminalState`) plus expected PNGs rendered with our renderer. Tests hydrate the snapshot, render into a headless canvas, and compare against the PNG using `pixelmatch`.
- **Pixel comparisons** – use `pixelmatch` with a low threshold (≈0.05) to allow minor anti-aliasing differences. On failure, write three artifacts per scenario under `test/__artifacts__/<case>/`: `expected.png`, `actual.png`, and `diff.png` (magenta highlights).
- **Composite artifact** – build `side-by-side.png` by rendering the three images into a new canvas with a dark background, 16px gutters, and a heading row (monospace text) labelling each column “expected”, “actual”, and “diff”. Keep hierarchy clear: labels at 14–16px, subtle separators (e.g. thin vertical lines, drop shadow) to emphasize differences, and consistent padding before exporting via `toBuffer()`.
- **Artifact plumbing** – Vitest’s `onTestFailed` hook (or per-test try/finally) dumps artifacts and logs their paths so CI can surface them. Locally, tests print `open test/__artifacts__/.../side-by-side.png` instructions; in CI we can attach them as build artifacts.
- **Snapshot refresh flow** – provide a script (`bun run test:update-snapshots`) that re-renders fixtures and overwrites the expected PNGs after manual review. Guard with git diffs to ensure updates are intentional.
- **Parameterized coverage** – cover core glyph types (ASCII, CJK, emojis, combining marks), attribute permutations (bold+italic, foreground/background combos, SGR resets), cursor states, palette swapping, resizing, and selection overlays. Each scenario renders minimal yet representative buffers to keep PNGs small.
- **Perf smoke tests** – include a stress case that renders a large dirty region and asserts draw call counts remain below a threshold; rely on diagnostics exposed by the renderer.

## Current status

- Public renderer contract exported from `src/index.ts`, including theme, metrics, and lifecycle types.
- Vitest harness in place (node-canvas + pixelmatch + snapshots) with an initial rendering smoke test.
- Package scripts wired for `vitest` execution; awaiting concrete drawing implementation.

## Immediate next steps

1. Implement the canvas renderer internals that honour the new interface and draw `@mana-ssh/vt` snapshots.
2. Expose utility helpers (measure cells, palette resolution, cursor drawing) with accompanying unit tests.
3. Publish typed entry point so `@mana-ssh/tui-react` can import the renderer instead of inlining it.

## Longer-term roadmap

- Benchmark canvas vs SVG/WebGL renderers once alternate packages exist.
- Add optional offscreen canvas support for smoother animations.
- Expose instrumentation hooks (FPS, draw timings) for performance dashboards.
- Consider fallback HTML renderer for legacy browsers that lack canvas acceleration.
