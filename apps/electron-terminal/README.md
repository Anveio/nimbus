# Mana Electron Terminal (scaffold)

This package hosts a hello-world Electron application that will evolve into the desktop shell for the Mana terminal stack.

## Goals
- Provide a desktop entry point that renders `@mana/tui-react`.
- Demonstrate how to bridge Electron to the WebSocket + SSH runtime stack.
- Establish Playwright-powered E2E coverage for the desktop experience.

## Current state
- Electron main/preload/renderer wiring compiled with esbuild
- Renderer shows a placeholder view describing the app version exposed from preload

## Usage
```
bun install
bun run build --filter @mana/electron-terminal
bun run --filter @mana/electron-terminal dev
```
The `dev` script rebuilds the renderer in watch mode and launches Electron pointing at the compiled output.

## Next steps
1. Integrate the websocket terminal bridge and glue it into `@mana/tui-react`.
2. Add local PTY bindings (native module) to support offline shells.
3. Layer on diagnostics, error UX, and Playwright end-to-end tests.
