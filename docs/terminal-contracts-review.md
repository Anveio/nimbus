# Nimbus Terminal Contract Review

This note captures the current state of the public contracts that tie the VT runtime, renderer implementations, React host bindings, and the web demo together. It is written for engineers who are new to Nimbus and need a guided tour of how the layers interact, what is working well, and where we can improve the developer experience.

## 1. VT Runtime (`@nimbus/vt`)

* **Contract surface** – `createDefaultTerminalRuntime()` (and the underlying `createTerminalRuntime` factory in `packages/vt/src/runtime.ts`) exposes a cohesive host-event API (`TerminalRuntimeEvent`) that covers cursoring, selection, pointer tracking, paste, and parser injection. The interface is well documented, making it easy for higher layers to stay out of interpreter internals.
* **Preset system** – The runtime now ships with a `'vt220-xterm'` preset and accepts either named presets or full preset objects alongside parser/capability overrides. This gives newcomers a one-line entry point while still letting advanced hosts tweak specs, emulator quirks, or individual feature flags by passing targeted overrides.
* **Response stream** – Hosts can register `onResponse` listeners to receive structured callbacks whenever the runtime emits host-directed bytes (pointer reports, wheel reports, bracketed paste guards, parser responses). This keeps transports from spelunking the `TerminalUpdate[]` diff and makes it obvious where to forward DEC reports.

## 2. Renderer Layer (`@nimbus/webgl-renderer` and `@nimbus/tui-web-canvas-renderer`)

* **Root/session contract** – The WebGL renderer follows the spec in `packages/webgl-renderer/docs/renderer-specification-v0.md`. `createRendererRoot(container, options)` returns an idempotent root that manages renderer sessions (`RendererSession`) with frame listeners, diagnostics, and lifecycle hooks. This is the right abstraction for hosts.
* **Event bridge duplication risk** – `RendererEvent` mirrors the runtime host union, but the logic that translates renderer events into runtime calls lives inside WebGL-only helpers (`packages/webgl-renderer/src/internal/runtime-bridge.ts`). Anyone building a new renderer (e.g. WebGPU or CPU canvas) will either copy that file or re-derive the same switch. We should hoist this bridge into a shared package (for example `@nimbus/host-bridge`) or re-export it so other renderers stay consistent.
* **Configuration ergonomics** – Hosts must fabricate complete `RendererConfiguration` objects (grid size, CSS size, DPR, framebuffer size, cell metrics). The React package currently guesses cell metrics (8×16) before fonts load. Providing a shared helper, such as `deriveRendererConfiguration(canvas, overrides)`, would make it easier for any host (React or not) to get sane defaults and then refine after the first frame.
* **Backend parity** – The canvas renderer mirrors the WebGL API surface, but `@nimbus/tui-react` is hard-wired to the WebGL entry point. Without a consistent adapter in the React layer, consumers cannot pick a CPU backend without re-implementing the provider stack.

## 3. React Host (`@nimbus/tui-react`)

* **Composition strength** – `<Terminal />` composes `RendererSurface`, `RendererSessionProvider`, and the hotkey boundary to hide most of the wiring. Consumers get a declarative React component that feels close to the “React.render” simplicity goal.
* **Configuration feedback loop** – `RendererSessionProvider` computes its own fallback configuration (`FALLBACK_CELL_METRICS`) and dispatches it immediately. We do not reconcile with renderer-provided metrics afterwards, so the grid can be inaccurate once fonts settle. We need a handshake—either by listening to frame metadata or by asking the renderer to probe cell metrics—to update the configuration after mount.
* **Runtime swapping footgun** – The provider updates internal refs when `rendererConfig.runtime` changes, but the session remains mounted. If a caller supplies a new runtime instance, the rendered session continues to use the old one. We should either treat `runtime` as immutable (documented) or detect changes and remount the session to avoid silent mismatches.
* **Surface for responses** – Hotkey handling dispatches runtime events, but there is no callback to observe the batches returned by the renderer session (which include `updates` and any host responses). Hosts that want to forward DEC responses to a transport or log telemetry currently have no API for it. Exposing an `onRuntimeEvent` or `onBatch` callback would close that loop.
* **Renderer selection** – The React package imports WebGL types directly (`RendererSessionProviderProps` references `@nimbus/webgl-renderer`). Offering a backend factory prop (e.g. `rendererFactory?: (canvas, options) => RendererRoot`) would let hosts opt into the CPU renderer or future renderers without forking the provider.

## 4. Web Demo Integration (`apps/web-demo`)

* **Terminal not mounted** – The current app focuses on AWS discovery and SigV4 signing, but it never renders `<Terminal />`. Without the terminal widget on the page, we cannot validate end-to-end wiring, transport interactions, or runtime responses in a real scenario.
* **Transport bridge missing** – `useSshSession` manages an SSH/WebSocket connection but never pushes data into a VT runtime or forwards runtime responses back to the socket. To demo the full stack we need a bridge that writes incoming PTY bytes into `TerminalRuntime.writeBytes`, listens for responses (mouse reports, bracketed paste), and sends them over the WebSocket.

## 5. Key Opportunities

1. **Shared runtime bridge** – Extract the renderer-to-runtime translation helpers into a reusable module so every renderer and host speaks the same contract without duplication.
2. **Automatic configuration helpers** – Provide utilities for DPI and cell-metric negotiation (`deriveRendererConfiguration`) and update the React provider to use renderer feedback after mount.
3. **Backend flexibility** – Extend `<Terminal />` with a backend selection hook or factory so hosts can choose WebGL vs CPU (and future renderers) declaratively.
4. **Runtime response callbacks** – Surface runtime batches/responses at the React layer to make transport integration straightforward.
5. **Wire the demo** – Mount `<Terminal />` inside `apps/web-demo`, feed it the SSH session, and forward runtime responses to the transport. This will be the canonical example that exercises the full contract from VT to the browser UI.

Addressing these items will move Nimbus closer to the “elegant default” experience we want—where a host can call a small number of high-level helpers (ideally a single function) and get a fully wired terminal with sensible defaults, while still retaining the depth and extensibility demanded by advanced users.
