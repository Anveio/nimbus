# WebGL Renderer Implementation Notes

This renderer targets the contract defined in `packages/tui-renderer-core/docs/renderer-specification-v0.md`. The factory exported from `@mana/webgl-renderer` is asynchronous because shader compilation and GPU context initialisation can be deferred; hosts should `await createRenderer(...)` before calling `mount`.

## Pointer and clipboard dispatch

The current `@mana/vt` runtime does not yet expose typed events for pointer gestures, wheel scrolling, or clipboard signalling. The renderer therefore treats the `runtime.pointer`, `runtime.wheel`, `runtime.copy`, `runtime.paste`, `runtime.focus`, and `runtime.blur` dispatches as handled within the renderer layer (to remain spec-compliant) but does not forward them into the runtime. Selection overlays and accessibility layers still receive those gestures via the host APIs. Once the runtime introduces the corresponding hooks we will forward the events directly and remove this divergence.

## Render pipeline summary

The renderer keeps the terminal snapshot authoritative inside the runtime. Each frame renders the VT buffer into a high-DPI 2D canvas and uploads the result to the WebGL back buffer as a single texture. This keeps the implementation deterministic while still leveraging GPU presentation. Future iterations can swap in a tile-based pipeline without breaking the renderer contract.

## Lifecycle behaviour

- `dispatch({ type: 'renderer.configure', ... })` immediately updates the backing buffers and remains authoritative until the next configuration.
- `mount` validates the host surface, creates or adopts a canvas, and schedules an initial frame.
- `free` resets GPU resources, clears listeners, and renders the instance unusable. Subsequent calls to `mount` or `dispatch` throw descriptive errors as required by the spec.

## Diagnostics

Frame callbacks provide duration estimates, draw-call counts, framebuffer metrics, and GPU upload size in bytes. The diagnostic payload is intentionally conservative: dirty-region coverage is reported as `1` because the entire texture is uploaded each frame in the current implementation.
