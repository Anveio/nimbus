# Terminal Web App

This package hosts the interactive browser demo for the Mana stack. It renders a `<Terminal />` component from `@mana/tui-react`, wires keyboard and paste events, and demonstrates how the React renderer can operate in a standalone setting (using local echo) before being connected to a real host.

## What it showcases

- Drop-in usage of `@mana/tui-react`: the app renders a self-contained terminal widget that internally manages the VT parser, interpreter, and canvas renderer.
- Input plumbing: keystrokes and clipboard events are captured and translated into byte streams that `onData` could forward to a transport (e.g. WebSocket, WebRTC).
- Renderer integration: the canvas renderer paints the terminal output, driven by the updates emitted from the interpreter.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Launches the Vite dev server (`http://localhost:5173`). |
| `npm run build` | Builds the production bundle via Vite. |
| `npm run preview` | Serves the production build locally. |
| `npm run test` | Runs unit tests via Vitest (jsdom). |
| `npm run test:e2e` | Executes Playwright end-to-end tests (headless). |
| `npm run test:e2e:headed` | Runs the same Playwright suite with a headed browser. |
| `npm run test:e2e:ui` | Opens Playwright’s interactive test runner UI. |

## Connecting to a real host

The current demo echoes data locally, but the structured props make it simple to connect to a real host.

1. Either hand the component a `transport` configuration (e.g. `{ kind: 'websocket', endpoint: 'wss://...' }`) or supply your own plumbing via `instrumentation.onData` + `terminalRef.current?.write(remoteBytes)`.
2. Toggle `styling.localEcho` depending on whether the transport echoes characters or you want optimistic rendering.
3. Observe render telemetry through `instrumentation.onFrame` and `terminalRef.current?.getRendererBackend()` when debugging backends.

## Folder layout

- `src/` – React entry point and styling.
- `test/` – Vitest unit tests (jsdom).
- `e2e/` – Playwright end-to-end specs.
- `vitest.config.ts`/`playwright.config.ts` – testing configuration.

This app is intentionally minimal; it serves as a reference integration for consumers embedding the terminal inside their own React applications.
