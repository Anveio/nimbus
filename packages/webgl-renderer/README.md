# @nimbus/webgl-renderer

GPU-backed renderer root/session runtime for Nimbus terminal hosts. This package
owns the WebGL renderer contract and provides host utilities for measuring the
canvas surface.

## Install

```bash
npm install @nimbus/webgl-renderer
```

## Quickstart

Use `deriveRendererConfiguration` to measure the canvas before mounting a
renderer session. The helper waits for fonts to settle, publishes surface
dimensions (host-defined logical units), surface density, framebuffer size, and
cell metrics, and keeps emitting updates when the canvas resizes or the density
changes.

```ts
import {
  createRendererRoot,
  deriveRendererConfiguration,
  type RendererConfiguration,
} from '@nimbus/webgl-renderer'

const canvas = document.querySelector('canvas')
if (!canvas) {
  throw new Error('Canvas element missing')
}

// 1. Measure the surface and subscribe to updates.
const configurationController = deriveRendererConfiguration(canvas)

// 2. Mount the renderer root using the initial configuration snapshot.
const configuration = configurationController.refresh()
const root = createRendererRoot(canvas, { configuration })
const session = root.mount()

// 3. Forward configuration updates back into the session.
const unsubscribe = configurationController.subscribe(
  (next: RendererConfiguration) => {
    session.dispatch({
      type: 'renderer.configure',
      configuration: next,
    })
  },
)

// 4. Dispatch runtime data as usual (diffs, responses, etc.).
session.dispatch({ type: 'runtime.data', data: 'hello, nimbus\n' })

// 5. Clean up when the canvas is removed.
const teardown = () => {
  unsubscribe()
  configurationController.dispose()
  session.unmount()
  session.free()
  root.dispose()
}
```

### Host responsibilities

- Call `configurationController.refresh()` whenever you suspect layout changes
  that the helper cannot observe automatically (e.g. when toggling navigation
  panes off-screen).
- Supply `measureCellMetrics` if your host uses a specialised font measurement
  pipeline or needs locale-specific heuristics.
- Always dispose both the renderer session and configuration controller during
  teardown to release WebGL resources and observers cleanly.

## Further reading

- [`docs/overview.md`](./docs/overview.md) — renderer architecture and contract
  summary.
- [`docs/renderer-specification-v0.md`](./docs/renderer-specification-v0.md) —
  canonical session contract.
