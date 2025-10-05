# Mana Electron Terminal (scaffold)

This package hosts a hello-world Electron application that will evolve into the desktop shell for the Mana terminal stack.

## Goals
- Provide a desktop entry point that renders `@mana/tui-react`.
- Demonstrate how to bridge Electron to the WebSocket + SSH runtime stack.
- Establish Playwright-powered E2E coverage for the desktop experience.

## Current state
- Electron main/preload/renderer wiring compiled with esbuild.
- Renderer placeholder awaiting `<Terminal />` integration.
- Preload exposes a minimal `window.mana.version` contract for renderer introspection.

## Usage
```
bun install
bun run build --filter @mana/electron-terminal
bun run --filter @mana/electron-terminal dev
```
The `dev` script rebuilds the renderer in watch mode and launches Electron pointing at the compiled output.

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
3. Establish Playwright end-to-end coverage for the Electron bundle.
4. Add local PTY bindings (native module) to support offline shells once the transport shim lands.
