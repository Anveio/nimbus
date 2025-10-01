# Terminal Web App

This package hosts the interactive browser demo for the Mana stack. It renders a `<Terminal />` component from `@mana/tui-react`, wires keyboard and paste events, and demonstrates how the React renderer can operate in a standalone setting (using local echo) before being connected to a real host.

## What it showcases

- Drop-in usage of `@mana/tui-react`: the app renders a self-contained terminal widget that internally manages the VT parser, interpreter, and canvas renderer.
- Input plumbing: keystrokes and clipboard events are captured and translated into byte streams that `onData` could forward to a transport (e.g. WebSocket, WebRTC).
- Renderer integration: the canvas renderer paints the terminal output, driven by the updates emitted from the interpreter.

## Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Launches the Vite dev server (`http://localhost:5173`). |
| `bun run build` | Builds the production bundle via Vite. |
| `bun run preview` | Serves the production build locally. |
| `bun run test` | Runs unit tests via Vitest (jsdom). |
| `bun run test:e2e` | Executes Playwright end-to-end tests (headless). |
| `bun run test:e2e:headed` | Runs the same Playwright suite with a headed browser. |
| `bun run test:e2e:ui` | Opens Playwright’s interactive test runner UI. |

## Connecting to a real host

The current demo echoes data locally, but the `onData` callback and `TerminalHandle.write()` API make it simple to bridge to a WebSocket or other transport. In a real deployment you would:

1. Subscribe to the terminal’s `onData` callback to forward user keystrokes to your backend transport.
2. Feed remote data back into the terminal via `terminalRef.current?.write(remoteBytes)`.
3. Optionally disable `localEcho` so output appears strictly when the backend acknowledges it.

## Folder layout

- `src/` – React entry point and styling.
- `test/` – Vitest unit tests (jsdom).
- `e2e/` – Playwright end-to-end specs.
- `vitest.config.ts`/`playwright.config.ts` – testing configuration.

This app is intentionally minimal; it serves as a reference integration for consumers embedding the terminal inside their own React applications.
