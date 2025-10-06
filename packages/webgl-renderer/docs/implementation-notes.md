# WebGL Renderer Implementation Notes

This renderer targets the contract defined in `docs/renderer-specification-v0.md` (v1). Hosts integrate via `createRendererRoot(container)`, which yields an idempotent root that mounts sessions and mediates lifecycle hooks. The root API is synchronous; shader compilation and context initialisation happen during the first `mount`.

## Pointer and clipboard dispatch

Pointer, wheel, focus, and paste events now feed directly into `@mana/vt` so that the runtime can honour DEC private modes (1000/1002/1003, 1004, 2004). Renderers are responsible for supplying cell-relative coordinates and modifier state so that the runtime can synthesise the appropriate control sequences (legacy, UTF-8, or SGR encodings). Copy remains a host-level concern because the interpreter only tracks OSC 52 writes; renderer layers should continue to expose selections to platform clipboards.

## Render pipeline summary

The renderer keeps the terminal snapshot authoritative inside the runtime. Each frame renders the VT buffer into a high-DPI 2D canvas and uploads the result to the WebGL back buffer as a single texture. This keeps the implementation deterministic while still leveraging GPU presentation. Future iterations can swap in a tile-based pipeline without breaking the renderer contract.

## Lifecycle behaviour

- `dispatch({ type: 'renderer.configure', ... })` immediately updates the backing buffers and remains authoritative until the next configuration.
- `createRendererRoot(container).mount(...)` validates the host surface, creates or adopts a canvas, and schedules an initial frame.
- `free` resets GPU resources, clears listeners, and renders the session unusable. Subsequent calls to `dispatch` throw descriptive errors as required by the spec.

## Diagnostics

Frame callbacks provide duration estimates, draw-call counts, framebuffer metrics, and GPU upload size in bytes. The diagnostic payload is intentionally conservative: dirty-region coverage is reported as `1` because the entire texture is uploaded each frame in the current implementation.
