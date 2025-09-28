# Terminal Web App – Agent Log

## Mission

Showcase the Mana SSH terminal stack inside a real browser application. The app should prove that `@mana-ssh/tui-react` can be embedded with zero glue code, handle keyboard/paste input, and expose hooks that a host transport can use to exchange bytes.

## Current status

- `<Terminal />` from `@mana-ssh/tui-react` renders the interactive canvas with local echo enabled by default.
- Demo automatically focuses the terminal on load and writes a welcome banner.
- Vitest (jsdom) unit tests ensure the scaffold renders and matches the expected layout; Playwright e2e smoke test validates the basic typing flow.
- Project reads configuration from Vite and offers scripts for dev, build, unit tests, and e2e runs.

## Immediate next steps

1. **Transport wiring** – Add an optional WebSocket demo that pipes `onData` to a backend proxy and feeds remote bytes back via `terminal.write()`. Provide environment-driven configuration for the proxy URL.
2. **Accessibility polish** – Layer focus styles, ARIA hints (e.g. live regions for bell events), and optional screen-reader friendly text output.
3. **Visual cues** – Surface diagnostics (FPS/draw calls) and connection state badges, so performance regressions are visible. Consider adding theme switcher presets.
4. **Clipboard integrations** – Demonstrate OSC 52 copy support by exposing a button that triggers a copy request through the host callback once interpreter support lands.
5. **Testing** – Expand Playwright coverage to ensure pasting, arrow keys, and resize flows behave correctly across browsers.

## Longer-term ideas

- Extensible demos: add a mock SSH back-end using `@mana-ssh/websocket` and `apps/proxy-server` for true round-trip testing.
- Embed multiple terminals/tabs to showcase how the renderer/host scales.
- Integrate tutorial overlays or guided tours explaining how to integrate the React component in external applications.
