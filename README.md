# Mana

Mana is a zero-dependency, standards-compliant, universally embeddable, high performance terminal with SSH remoting capabilities.

## Layer map
- Parser and interpreter: `@mana/vt`
- Renderer backends: `@mana/tui-web-canvas-renderer` today, SVG/WebGL/native next
- React bindings: `@mana/tui-react`
- SSHv2 Protocol Implementation: `@mana/ssh-v2` (under construction)
- Browser transports: `@mana/web`, `@mana/websocket` (planned)
- Demo and infra: `apps/terminal-web-app`, `apps/proxy-server`, `apps/simulated-instance`

Status legend: Delivered = in main, In progress = active work, Planned = design/backlog.

## Codec and glyph support
| Capability | Layer | Status | Notes |
| --- | --- | --- | --- |
| 7-bit ASCII stream handling | Parser, interpreter | Delivered | ECMA-48 ground/escape/CSI states emit Print/Execute events.
| 8-bit control acceptance | Parser | Delivered | `acceptEightBitControls` default aligns with modern emulators.
| UTF-8 decoding | Parser | In progress | TextEncoder wiring landed; validation fixtures expanding.
| ISO-2022 charset shifts | Parser | Planned | Charset tables and shift states queued after VT320 work.
| Wide (CJK) glyph layout | Interpreter, renderer | In progress | Cell width tracking present; paint metrics under test.
| Combining marks | Renderer | Planned | Glyph composition pipeline planned for canvas renderer.
| Emoji fallback | Renderer | Planned | Font fallback and metrics cache on renderer roadmap.
| Sixel and inline graphics | Parser, renderer | Planned | Decoder hooks will reuse DCS streaming events.

## Emulator and spec profiles
| Target | Scope | Status | Notes |
| --- | --- | --- | --- |
| DEC VT100 | Parser, interpreter | In progress | Core CSI/DECSET paths live; DECCOLM handling pending.
| DEC VT220 | Parser, interpreter | In progress | Parser tables follow ECMA-48; interpreter coverage expanding.
| DEC VT320 / VT420 | Parser, interpreter | Planned | Capability descriptors scaffolded for upcoming releases.
| DEC VT500 series | Parser | Planned | Transition tables extensible; profiles not encoded yet.
| xterm (modern) | Parser, interpreter | In progress | Quirk overlay hooks exist; palette and OSC extensions underway.
| kitty | Interpreter, renderer | Planned | Selection and graphics parity tracked against kitty specs.
| Ghostty | Renderer | Planned | Selection pipeline modelled on Ghostty behaviour notes.

## Control and quirk handling
| Quirk | Config surface | Status | Notes |
| --- | --- | --- | --- |
| C1 handling mode | `c1Handling` (`spec`, `escaped`, `execute`, `ignore`) | Delivered | Runtime-selectable per session.
| 7-bit vs 8-bit sequences | `acceptEightBitControls` toggle | Delivered | Enabled by default; disable for legacy hosts.
| CSI guard rails | Parser state machine | Delivered | Parameter overflow and cancel flows covered by tests.
| OSC length caps | `stringLimits` config | Delivered | Per-channel limits cancel payloads safely.
| DCS passthrough | Parser events | Delivered | Hook/Put/Unhook events stream binary payloads.
| Palette updates (OSC 4/104) | Interpreter, renderer | In progress | Deltas emitted; renderer applying updates this cycle.
| Selection deltas | Interpreter, React, renderer | In progress | Interpreter emits updates; React and canvas wiring underway.
| Clipboard (OSC 52) | Interpreter, host | Planned | Spec references stored; host integration pending.

## Rendering and UX targets
| Capability | Status | Notes |
| --- | --- | --- |
| Canvas renderer (`@mana/tui-web-canvas-renderer`) | Delivered | Lifecycle contract exported; palette and selection polish ongoing.
| SVG renderer | Planned | Will implement shared renderer interface for accessibility focus.
| WebGL / offscreen renderer | Planned | Targeting high FPS and diagnostics instrumentation.
| React `<Terminal />` component | In progress | Zero-boilerplate API rewrite scheduled in current sprint.
| React Native adapter | Planned | Will reuse controller/host abstractions.
| Accessibility overlays | Planned | ARIA and live region support scoped in demo backlog.

## SSH protocol and transport
| Capability | Status | Notes |
| --- | --- | --- |
| SSHv2 key exchange and cipher suite | In progress | `@mana/protocol` scaffolding state machine and crypto plumbing.
| Channel and window management | Planned | Scheduled after key exchange milestone.
| Browser WebSocket transport | Planned | `@mana/websocket` package stub pending protocol milestone.
| Alternate transports (HTTP/3, QUIC, SSE) | Planned | API contracts drafted; awaiting protocol baseline.
| Proxy bridge (`apps/proxy-server`) | Delivered | WebSocket <-> TCP relay for development and tests.
| Simulated host (`apps/simulated-instance`) | Delivered | Amazon Linux 2023 SSH target via Finch/Docker.

## Tooling and verification
| Area | Status | Notes |
| --- | --- | --- |
| Property-based parser tests | Delivered | Fast-check coverage for classifier and CSI flows.
| Pixel regression harness | Delivered | Node-canvas + pixelmatch baseline; palette cases queued.
| React component tests | Delivered | Vitest + Testing Library cover render lifecycle.
| E2E typing smoke tests | Delivered | Playwright scripts exercise the demo app.
| Performance diagnostics | Planned | Renderer FPS/draw instrumentation tracked in backlog.

## Quick start
```
bun install
bun run dev --filter apps/terminal-web-app
bun run test
```
