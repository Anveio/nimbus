# Mana

Mana is a zero-dependency, standards-compliant, universally embeddable terminal stack. The project embraces strict layering so that runtimes, renderers, and host frameworks can be swapped without touching each other.

```
            +-----------------------------+
            |    Batteries-Included SDKs  |
            |    (@mana/react, ...)       |
            +---------------▲-------------+
                            │ renderer contracts
            +---------------┴-------------+
            |     Renderer Layer          |
            |  (@mana/webgl-renderer,     |
            |   @mana/cpu-canvas-renderer,|
            |   @mana/svg-renderer, …)    |
            +---------------▲-------------+
                            │ runtime contracts
            +---------------┴-------------+
            |        VT Core              |
            |          (@mana/vt)         |
            +---------------▲-------------+
                            │ transports
            +---------------┴-------------+
            |   Protocol / Transport      |
            |    (@mana/ssh, websocket)   |
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
| VT Core | `@mana/vt` | Parser + interpreter. Emits immutable snapshots/diffs. |
| Renderer Layer | `@mana/webgl-renderer` (today) · `@mana/cpu-canvas-renderer` (planned) · `@mana/svg-renderer` (planned) | All conform to a shared renderer root/session contract; abstract away VT details from hosts. |
| Host Adapters | `@mana/react` (currently `packages/tui-react`) · `@mana/angular` (planned) · `@mana/vue` (planned) | Batteries-included components/hooks per framework. Import renderers only through the renderer API. |
| Protocol & Transport | `@mana/ssh`, `@mana/websocket`, `@mana/web` | SSH state machine, WebSocket policies, browser SDK composition. |
| Apps & Tools | `apps/web-demo`, `apps/proxy-server`, `apps/simulated-instance`, `apps/electron-demo` (planned) | Reference experiences, infra bridges, deterministic fixtures. |

## Layer Contracts
1. **Renderer ↔ VT** — Renderer packages receive `TerminalRuntime` handles, diffs, and renderer events through a documented API. They must not depend on host frameworks.
2. **Host ↔ Renderer** — Hosts instantiate renderer roots via `createRendererRoot`, dispatch renderer events, and read frame callbacks. Host packages never import `@mana/vt` directly; they rely on renderer exports.
3. **Transport ↔ Host** — Transport packages (e.g. `@mana/ssh`, `@mana/websocket`) deliver byte streams to host adapters, which forward them to the renderer/runtime. As long as transports emit spec-compliant VT byte streams, any runtime that honours the contract will behave identically—allowing SSH implementations and VT engines to evolve independently.

## Batteries-Included Hosts
- `@mana/react` (current `packages/tui-react`) — provides `<Terminal />`, accessibility overlays, hotkey pipeline, and renderer session orchestration.
- Future: `@mana/angular`, `@mana/vue` — will mirror the React API surface while leveraging the same renderer contracts.

## Renderer Roadmap
| Renderer | Status | Highlights |
| --- | --- | --- |
| `@mana/webgl-renderer` | Active | GPU glyph cache, damage tracking, accessibility overlays. |
| `@mana/cpu-canvas-renderer` | Planned | Deterministic fallback, SSR-friendly previews. |
| `@mana/svg-renderer` | Planned | Server-side rendering, high accessibility, printable output. |

## Runtime Roadmap
| Capability | Status | Notes |
| --- | --- | --- |
| ECMA-48 core (VT100/220) | Active | DECSET, cursor, scroll regions covered; DECCOLM nearing completion. |
| Modern emulator quirks (xterm/kitty/Ghostty) | In flight | Overlay system supports per-emulator behaviour. |
| Graphics (Sixel, iTerm2 images) | Planned | DCS streaming hooks ready; decoders forthcoming. |

## Developer Experience
- `npm run dev -- --filter apps/web-demo` — spin up the demo app.
- `npm run build --workspace=@mana/tui-react` — produce the browser-ready React bundle using `vite.production.config.ts`.
- `npm run test -- --filter @mana/tui-react` — Vitest + Playwright suites.
- `npm run test -- --filter @mana/vt` — parser/interpreter property tests.
- Real SSH target: see [docs/aws-dev-target.md](docs/aws-dev-target.md) for a CDK stack that provisions an ephemeral Amazon Linux instance (costs pennies; destroy when finished).
- Helpers:
  - `npm run infra:dev-ssh:deploy` — deploy the dev EC2 instance (see docs for required context).
  - `npm run infra:dev-ssh:destroy` — tear the stack down when you’re done.

## Contributing Workflow
- Adhere to package contracts; modify APIs only after updating specs and agents.
- Keep doc sources (`README.md`, package `AGENTS.md`) current with architectural decisions.
- Use the layered abstraction to isolate work: VT, renderer, host, and transports each move independently as long as contracts stay green.

We’re building for the long term: take the time to make each layer clean, unit-tested, and swappable. When users need a drop-in WebGL terminal, a CPU fallback, or a bespoke renderer, Mana should already have paved the path.
