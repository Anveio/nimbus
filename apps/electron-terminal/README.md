# Mana Electron Terminal (scaffold)

This package hosts a hello-world Electron application that will evolve into the desktop shell for the Mana terminal stack.

## Goals
- Provide a desktop entry point that renders `@mana/tui-react`.
- Demonstrate how to bridge Electron to the WebSocket + SSH runtime stack.
- Establish Playwright-powered E2E coverage for the desktop experience.

## Current state
- Electron main/preload/renderer wiring compiled with esbuild.
- Renderer boots the `@mana/tui-react` terminal against the preload session bridge.
- Preload exposes a minimal `window.mana.version` contract for renderer introspection.
- Playwright smoke suite launches the packaged Electron bundle and exercises the echo transport end-to-end.

## Usage
```
npm install
npm run build -- --filter @mana/electron-terminal
npm run dev -- --filter @mana/electron-terminal
```
The `dev` script rebuilds the renderer in watch mode and launches Electron pointing at the compiled output.

## Testing
1. Build the Electron bundle: `npm run build -- --filter @mana/electron-terminal`.
2. Execute the headless E2E run: `npm run test -- --filter @mana/electron-terminal`.

The Playwright spec uses the default echo transport, waits for the preload bridge to report `ready`, and asserts that the terminal surface receives the banner emitted by `EchoSession`. The harness mirrors the browser-based tests: the compiled Electron main process is launched directly, and the renderer window is driven through the Playwright Electron helpers described in [the upstream docs](https://playwright.dev/docs/api/class-electron).

## Architecture plan
1. **Renderer shell** – Mount `<Terminal />` from `@mana/tui-react`, sourced through a tiny React wrapper (`<ElectronTerminalApp />`). The component receives a bridge object from preload that exposes:
   - `send(data: Uint8Array)` to push user input toward the main process.
   - `onData(callback)` subscription for host → terminal bytes.
   - Connection + diagnostic events used for status banners and logs.
2. **Preload bridge** – Owns the durable channel between renderer (DOM world) and Electron main. It is the single place we touch `ipcRenderer` and converts between `Uint8Array` and structured payloads.
3. **Main process orchestrator** – Manages websocket SSH sessions (initial milestone) and future PTY adapters. It exposes typed IPC handlers (`open-session`, `close-session`, `write-data`) and streams diagnostics back. An `echo` transport ships alongside as an offline fallback so the UI can run without network services.
4. **Testing harness** – Playwright spins up the packaged Electron app, injects the tui-react harness helpers into the renderer window, and validates canvas output, accessibility, and byte flow using the simulated SSH backend.

## Next steps
1. Replace the placeholder React view with the terminal composition described above.
2. Implement the websocket-backed session bridge and preload IPC contract.
3. Expand Playwright coverage to include reconnect flows, resize negotiation, and transport errors.
4. Add local PTY bindings (native module) to support offline shells once the transport shim lands.
