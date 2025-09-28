# @mana-ssh/tui-web-canvas-renderer – Agent Log

## Mission

Deliver a standalone, high-performance canvas renderer for the Mana SSH terminal stack. This package is responsible for taking the interpreter output from `@mana-ssh/vt` (screen buffer, cursor state, attributes) and drawing it into an HTML `<canvas>` element. It must track cursor/selection, handle resize events gracefully, and provide hooks so higher-level frameworks (React, vanilla JS, etc.) can embed the renderer in any web application.

## Design goals

- **Renderer-only responsibility** – no parser or interpreter logic. Consumers feed the renderer with terminal snapshots/updates.
- **Pluggable API** – expose a simple interface (`init`, `applyUpdates`, `resize`, `dispose`) so UI layers can orchestrate lifecycle without knowing about the drawing internals.
- **Performance-first** – leverage canvas 2D context (and GPU acceleration where available) to minimise DOM churn. Keep allocations low, batch draw calls, and provide dirty-region updates.
- **Robustness** – support dynamic resize, high-DPI displays, cursor inversion, theme changes, and fall back gracefully when palette entries are missing.
- **Extensibility** – act as the reference implementation for future renderers (SVG, WebGL, React Native). Document the renderer contract so new backends can be dropped in.

## Current status

- Package scaffolded with `package.json` (no implementation yet).
- Renderer contract defined conceptually; awaiting type definitions that mirror interpreter output.
- No exports or build scripts in place.

## Immediate next steps

1. Define TypeScript interfaces for renderer options, theme, cell metrics, and update application (mirroring the `Renderer` interface currently embedded in `tui-react`).
2. Port the existing canvas drawing logic from `tui-react` into this package, turning it into a reusable class/function.
3. Expose utility helpers (measure cells, palette resolution, cursor drawing) with unit tests.
4. Publish typed entry point so `@mana-ssh/tui-react` can import the renderer instead of inlining it.

## Longer-term roadmap

- Benchmark canvas vs SVG/WebGL renderers once alternate packages exist.
- Add optional offscreen canvas support for smoother animations.
- Expose instrumentation hooks (FPS, draw timings) for performance dashboards.
- Consider fallback HTML renderer for legacy browsers that lack canvas acceleration.
