# @mana-ssh/tui-react – Agent Log

## Mission

Build a world-class, high-performance, and minimal-dependency TypeScript renderer that brings the `@mana-ssh/vt` parser + interpreter stack to the web through React. The package should feel natural for any React host (plain DOM, Vite, Next.js, Electron renderer) while leaving room for sibling renderers (e.g. React Native, canvas/WebGL, WASM) to reuse the same host/controller abstractions.

## Technical approach

1. **Layered design** – treat this package as the presentation layer. It consumes parser/interpreter events via `@mana-ssh/vt`, maintains no terminal semantics of its own, and focuses purely on rendering + user interaction.
2. **Renderer abstraction** – expose a renderer registry instead of baking drawing logic into this package. Each renderer lives in its own module (e.g. `@mana-ssh/tui-web-canvas-renderer` for DOM canvas) and implements a shared interface so React can select the appropriate backend at runtime.
3. **Host interface** – define a generic `TerminalHost` (write/onData/resize/dispose) that can wrap WebSockets, node-pty, ssh2, WASM PTYs, etc. React components/hooks simply accept a host instance and never couple to transport details.
4. **Controller hook** – ship a `useTerminalController` hook that wires parser + interpreter, buffers events, and exposes `write/reset/snapshot` for renderers. All renderers use this hook to stay in sync with terminal state.
5. **React components** – provide a declarative `<TerminalCanvas />` component that wires the host/controller to a pluggable renderer (defaults to the canvas package) and handles lifecycle + input wiring.
6. **Future targets** – keep the package DOM-friendly but do not assume a single universal renderer. Plan for additional adapters (e.g. `@mana-ssh/tui-web-svg-renderer`, `@mana-ssh/tui-react-native`) that reuse the same controller and host contracts.

## Current status

- Canvas renderer lives in `@mana-ssh/tui-web-canvas-renderer`; this package now consumes it via a renderer interface.
- React integration is in progress (controller hook, `<TerminalCanvas />` wrapper, host abstraction).
- Mock host + demo React app (apps/terminal-web-app) scaffolded.
- Keyboard input → host write path partially implemented; advanced key handling TBD.

## Immediate next steps

- Finalise `useTerminalController` API (stabilise host lifecycle, expose resize, add optional onUpdate callbacks).
- Harden `<TerminalCanvas />` (cursor blinking, resize handling, focus outlines, pointer events, clipboard hooks) and ensure renderer selection is configurable.
- Replace mock host in demo with a WebSocket host targeting the proxy server to prove end-to-end bytes flow.
- Add automated tests: DOM snapshot for renderer, hook unit tests with fake host, integration test via jsdom canvas.

## Longer-term roadmap

- Implement alternative renderers (SVG/WebGL) behind the same renderer interface for benchmarking.
- Deliver `@mana-ssh/tui-react-native` reusing the controller/host layer with native views.
- Add input extensions: mouse reporting, bracketed paste, clipboard OSC 52, custom keymaps.
- Expose theming utilities (palette presets, cursor styles) and guidance on accessibility (screen reader overlays, ARIA roles).
