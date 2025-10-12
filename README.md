# Nimbus

Nimbus is a zero-dependency, standards-compliant, universally embeddable terminal stack. The project embraces strict layering so that runtimes, renderers, and host frameworks can be swapped without touching each other.

```
            +-----------------------------+
            |    Batteries-Included SDKs  |
            |    (@nimbus/react, ...)       |
            +---------------▲-------------+
                            │ renderer contracts
            +---------------┴-------------+
            |     Renderer Layer          |
            |  (@nimbus/webgl-renderer,     |
            |   @nimbus/cpu-canvas-renderer,|
            |   @nimbus/svg-renderer, …)    |
            +---------------▲-------------+
                            │ runtime contracts
            +---------------┴-------------+
            |        VT Core              |
            |          (@nimbus/vt)         |
            +---------------▲-------------+
                            │ transports
            +---------------┴-------------+
            |   Protocol / Transport      |
            |    (@nimbus/ssh, @nimbus/websocket) |
            +-----------------------------+
```

## Vision
- **Composable terminals** — swap runtimes or renderers at will, even at runtime, to match platform constraints (WebGL vs CPU vs SVG) or host preferences.
- **Framework-friendly** — ship batteries-included adapters for React first, with Angular/Vue on deck, all backed by the same renderer contracts.
- **Spec fidelity** — keep VT parsing/interpreting pure and deterministic while letting hosts layer UX affordances.
- **Open ecosystem** — document the contracts so third-party VT engines or renderers can plug in without private knowledge.

## Package Taxonomy

| Layer | Packages | Notes |
| --- | --- | --- |
| VT Core | `@nimbus/vt` | Parser + interpreter. Emits immutable snapshots/diffs. |
| Renderer Layer | `@nimbus/webgl-renderer` (today) · `@nimbus/cpu-canvas-renderer` (planned) · `@nimbus/svg-renderer` (planned) | All conform to a shared renderer root/session contract; abstract away VT details from hosts. |
| Host Adapters | `@nimbus/react` (currently `packages/tui-react`) · `@nimbus/angular` (planned) · `@nimbus/vue` (planned) | Batteries-included components/hooks per framework. Import renderers only through the renderer API. |
| Protocol & Transport | `@nimbus/ssh`, `@nimbus/websocket` | SSH state machine and WebSocket transport surfaces. |
| Apps & Tools | `apps/web-demo`, `apps/proxy-server`, `apps/simulated-instance`, `apps/electron-demo` (planned) | Reference experiences, infra bridges, deterministic fixtures. |

## Layer Contracts
1. **Renderer ↔ VT** — Renderer packages receive `TerminalRuntime` handles, diffs, and renderer events through a documented API. They must not depend on host frameworks.
2. **Host ↔ Renderer** — Hosts instantiate renderer roots via `createRendererRoot`, dispatch renderer events, and read frame callbacks. Host packages never import `@nimbus/vt` directly; they rely on renderer exports.
3. **Transport ↔ Host** — Transport packages (e.g. `@nimbus/ssh`, `@nimbus/websocket`) deliver byte streams to host adapters, which forward them to the renderer/runtime. As long as transports emit spec-compliant VT byte streams, any runtime that honours the contract will behave identically—allowing SSH implementations and VT engines to evolve independently.

## Batteries-Included Hosts
- `@nimbus/react` (current `packages/tui-react`) — provides `<Terminal />`, accessibility overlays, hotkey pipeline, and renderer session orchestration.
- Future: `@nimbus/angular`, `@nimbus/vue` — will mirror the React API surface while leveraging the same renderer contracts.

## Renderer Roadmap
| Renderer | Status | Highlights |
| --- | --- | --- |
| `@nimbus/webgl-renderer` | Active | GPU glyph cache, damage tracking, accessibility overlays. |
| `@nimbus/cpu-canvas-renderer` | Planned | Deterministic fallback, SSR-friendly previews. |
| `@nimbus/svg-renderer` | Planned | Server-side rendering, high accessibility, printable output. |

## Runtime Roadmap
| Capability | Status | Notes |
| --- | --- | --- |
| ECMA-48 core (VT100/220) | Active | DECSET, cursor, scroll regions covered; DECCOLM nearing completion. |
| Modern emulator quirks (xterm/kitty/Ghostty) | In flight | Overlay system supports per-emulator behaviour. |
| Graphics (Sixel, iTerm2 images) | Planned | DCS streaming hooks ready; decoders forthcoming. |

## Developer Experience
1. Install baseline tooling
   - Node.js 24 via `nvm install 24 && nvm use 24` (or your preferred installer).
   - AWS CLI v2 (`brew install awscli`, `sudo apt install awscli`, or AWS MSI). Verify with `aws --version`, then run `aws configure` (or `aws configure sso`) so CDK has credentials.
   - Optional: `npm install -g aws-cdk` or use `npx cdk` (our scripts call `npx` by default).
2. Bootstrap the repo
   - `npm install`
   - `npm run dev -- --filter apps/web-demo` — spin up the demo app.
   - `npm run build --workspace=@nimbus/tui-react` — produce the browser-ready React bundle using `vite.production.config.ts`.
   - `npm run test -- --filter @nimbus/tui-react` — Vitest + Playwright suites.
   - `npm run test -- --filter @nimbus/vt` — parser/interpreter property tests.
3. Optional infrastructure helpers
  - Real SSH target: see [docs/aws-dev-target.md](docs/aws-dev-target.md) for CDK details.
  - Optional overrides: `MANA_DEV_SSH_ALLOWED_IP` (CIDR) and `MANA_DEV_SSH_STACK_NAME`.
  - `npm run infra -- --filter @nimbus/web-demo` — synthesize the stack (no changes applied).
  - `npm run infra -- --filter @nimbus/web-demo -- --deploy` — deploy the dev EC2 instance (the script automatically opens the security group to your current public IP).
  - `npm run infra -- --filter @nimbus/web-demo -- --destroy` — tear the stack down when finished.

## Contributing Workflow
- Adhere to package contracts; modify APIs only after updating specs and agents.
- Keep doc sources (`README.md`, package `AGENTS.md`) current with architectural decisions.
- Use the layered abstraction to isolate work: VT, renderer, host, and transports each move independently as long as contracts stay green.

We’re building for the long term: take the time to make each layer clean, unit-tested, and swappable. When users need a drop-in WebGL terminal, a CPU fallback, or a bespoke renderer, Nimbus should already have paved the path.
