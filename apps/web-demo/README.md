# Web Demo

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

## Cleaning up demo infrastructure

If you provision the AWS demo stacks, tear them down when you’re finished to avoid stray instances or buckets. From `apps/web-demo`:

```bash
npm run infra:testing-destroy               # remove the testing stack
npm run infra:destroy                       # remove the dev stack
npm run infra:cleanup-tagged -- --wait      # sweep any remaining tagged stacks
```

Run `npm run infra:cleanup-tagged -- --dry-run` first if you want a preview of what will be deleted. All helper scripts tag resources with `mana:*` keys so cleanup is deterministic.

## Connecting to a real host

The current demo echoes data locally, but the structured props make it simple to connect to a real host.

1. Either hand the component a `transport` configuration (e.g. `{ kind: 'websocket', endpoint: 'wss://...' }`) or supply your own plumbing via `instrumentation.onData` + `terminalRef.current?.write(remoteBytes)`.
2. Toggle `styling.localEcho` depending on whether the transport echoes characters or you want optimistic rendering.
3. Observe render telemetry through `instrumentation.onFrame` and `terminalRef.current?.getRendererBackend()` when debugging backends.

### Generate AWS SigV4 signed URLs

The Connect panel now includes a SigV4 helper so you can presign the Instance Connect websocket endpoint without dropping to a terminal.

- Paste the base websocket endpoint (defaulting to the Mana demo deployment).
- Provide temporary AWS credentials (access key, secret, optional session token) along with region/service overrides as needed.
- Click **Generate signed URL** to produce an expiring websocket URL—the result is injected into the main "Signed WebSocket URL" field.
- When the dev infra is deployed you can click **Request signed URL** to call the ephemeral AWS signer Lambda instead of pasting credentials. The helper caches the signer endpoint and bearer token in `.mana/web-demo/signer.json`; remove that file (or destroy the stack) to revoke access.

The helper runs entirely inside the browser; revoke the session immediately after use if you are working with elevated credentials.

## Folder layout

- `src/` – React entry point and styling.
- `test/` – Vitest unit tests (jsdom).
- `e2e/` – Playwright end-to-end specs.
- `vitest.config.ts`/`playwright.config.ts` – testing configuration.

This app is intentionally minimal; it serves as a reference integration for consumers embedding the terminal inside their own React applications.
