# Web Demo

This package hosts the interactive browser demo for the Nimbus stack. It renders a `<Terminal />` component from `@nimbus/tui-react`, wires keyboard and paste events, and demonstrates how the React renderer can operate in a standalone setting (using local echo) before being connected to a real host.

## What it showcases

- Drop-in usage of `@nimbus/tui-react`: the app renders a self-contained terminal widget that internally manages the VT parser, interpreter, and canvas renderer.
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

## Cleaning up demo infrastructure

If you provision the AWS demo stacks, tear them down when you’re finished to avoid stray instances or buckets. From `apps/web-demo`:

```bash
npm run infra:testing-destroy               # remove the testing stack
npm run infra:destroy                       # remove the dev stack
npm run infra:cleanup-tagged -- --wait      # sweep any remaining tagged stacks
```

Run `npm run infra:cleanup-tagged -- --dry-run` first if you want a preview of what will be deleted. All helper scripts tag resources with `mana:*` keys so cleanup is deterministic; these tag names remain unchanged until the AWS cleanup tooling is migrated.

## Connecting to a real host

The current demo echoes data locally, but the structured props make it simple to connect to a real host.

1. Either hand the component a `transport` configuration (e.g. `{ kind: 'websocket', endpoint: 'wss://...' }`) or supply your own plumbing via `instrumentation.onData` + `terminalRef.current?.write(remoteBytes)`.
2. Toggle `styling.localEcho` depending on whether the transport echoes characters or you want optimistic rendering.
3. Observe render telemetry through `instrumentation.onFrame` and `terminalRef.current?.getRendererBackend()` when debugging backends.

### Generate AWS SigV4 signed URLs

The Connect panel now includes a SigV4 helper backed by the dev infra’s signer Lambda so you can presign the Instance Connect websocket endpoint without pasting AWS credentials.

- Paste the base websocket endpoint (defaults to the Nimbus demo deployment) or adjust region/service overrides if needed.
- Click **Request signed URL** to call the signer; the result is injected into the main "Signed WebSocket URL" field.
- The signer API also exposes `/discovery`, which returns Nimbus-tagged instances, VPCs, and EC2 Instance Connect endpoints so tooling can auto-populate connection metadata.

The helper reads signer metadata from `.nimbus/web-demo/signer.json`. Redeploy the stack (or delete the cache file) to rotate the signer token. The Vite build config inlines both the signer and discovery endpoints (deriving `/discovery` from older caches that only know about `/sign`), so no manual `VITE_*` environment wiring is required once the helper file exists.

## Folder layout

- `src/` – React entry point and styling.
- `test/` – Vitest unit tests (jsdom).
- `e2e/` – Playwright end-to-end specs.
- `vitest.config.ts`/`playwright.config.ts` – testing configuration.

This app is intentionally minimal; it serves as a reference integration for consumers embedding the terminal inside their own React applications.
