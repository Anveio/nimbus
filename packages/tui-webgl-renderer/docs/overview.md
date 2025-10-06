# @mana/tui-webgl-renderer

The WebGL renderer owns the Mana VT runtime lifecycle, converts interpreter
updates into GPU frames, and exposes the canonical `RendererInstance` contract
from `renderer-contract.md`. Host surfaces supply measurement data and input
via `renderer.configure` and `runtime.*` dispatches while the renderer manages
canvas allocation, DPI scaling, glyph atlas upkeep, and diagnostics emission.

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

See `src/index.ts` for the renderer entry point and `src/internal` for helper
utilities.
