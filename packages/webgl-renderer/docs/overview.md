# @nimbus/tui-webgl-renderer

The WebGL renderer owns the Nimbus VT runtime lifecycle, converts interpreter
updates into GPU frames, and now exposes the `RendererRoot`/`RendererSession`
contract described in `renderer-specification-v0.md` (v1). Hosts obtain an
idempotent root via `createRendererRoot(container, options)` and mount sessions
that mediate configuration, input dispatch, and diagnostics.

This package is built on top of the Canvas renderer session primitives to reuse
battle-tested glyph atlas and damage tracking pipelines. The runtime adapter in
this package is responsible for translating contract events to
`TerminalRuntime` mutations, scheduling frames, and presenting snapshots to the
shared session layer.

Key capabilities:

- Spec-compliant event dispatcher covering all `runtime.*`,
  `renderer.configure`, and `profile.update` variants.
- Automatic DPI negotiation honouring `framebufferPixels` overrides and
  remount-safe state restoration.
- Frame callbacks with GPU diagnostics mapped to the renderer-core schema.
- Optional buffer serialization for pixel-perfect regression snapshots.
- Host-facing configuration helper `deriveRendererConfiguration(canvas, options)`
  that measures CSS pixel bounds, device pixel ratio, and cell metrics once
  fonts settle. Hosts subscribe to the controller to feed canonical metrics back
  into renderer sessions after resizes or zoom changes.

See `src/index.ts` for the renderer root entry point and `src/internal` for
helper utilities.
