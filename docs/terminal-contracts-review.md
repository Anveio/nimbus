# Nimbus Terminal Contract Review

This note captures the current state of the Nimbus terminal stack—VT runtime, renderer implementations, host bindings, and the demo app. It highlights what is already solid, what changed recently, and which gaps still block a “drop it in and it just works” story.

---

## 1. VT Runtime (`@nimbus/vt`)

- **Preset-first runtime (✅ Delivered).** `createDefaultTerminalRuntime()` wires the `'vt220-xterm'` preset and hides parser plumbing; `createTerminalRuntime()` still accepts overrides so advanced hosts can swap specs, emulator quirks, or capability flags without re-implementing resolution.
- **Structured response stream (✅ Delivered).** `onResponse` listeners fire for `pointer-report`, `wheel-report`, `paste-guard`, and `parser-response`, so transports can forward DEC traffic without spelunking `TerminalUpdate[]`.
- **Follow-up notes.**
  - Document how presets merge with explicit `parser`/`capabilities` overrides (current behaviour is additive but deserves a worked example).
  - Consider lightweight diagnostics (e.g., warn when `onResponse` has no listeners) so hosts discover missing wiring quickly.

Runtime responsibilities now feel crisp—the outstanding work sits downstream where renderers and hosts consume the contract.

---

## 2. Renderer Layer (`@nimbus/webgl-renderer`)

- **Spec v1 compliance (✅ WebGL).** `createRendererRoot` stays idempotent, exposes `onFrame`/`onResizeRequest`, and now forwards runtime responses through `onRuntimeResponse`.
- **CPU renderer reboot (🛑 Blocked).** The legacy canvas package has been retired. We need a clean-sheet CPU renderer before re-enabling the canvas backend in hosts or adding parity tests.
- **Configuration ergonomics (⚠️ Outstanding).** Hosts still fabricate `RendererConfiguration`. React guesses 8×16 cells on mount. A shared helper—`deriveRendererConfiguration(canvas, overrides)`—would de-duplicate fallbacks and let renderers feed back measured metrics after fonts settle.
- **Documentation debt.** Update the renderer spec once the configuration helper lands and the CPU backend aligns with WebGL; today the doc implies each renderer is responsible for its own bridge logic, which is acceptable so long as the behaviour stays in sync.

---

## 3. React Host (`@nimbus/tui-react`)

- **Composition + response forwarding (✅ Delivered).** `<Terminal />` still layers `RendererSurface`, `RendererSessionProvider`, and the hotkey boundary, now exposing `onRuntimeResponse` so transports can bridge DEC outputs without accessing diffs.
- **Backend registry (✅ Delivered, needs follow-up).** `registerRendererBackend`, the `rendererBackend` prop, and the default import (`@nimbus/tui-react`) keep WebGL as the out-of-the-box renderer. Experimental entry points (`@nimbus/tui-react/webgl`, `/canvas`) are ready but the canvas variant is a placeholder until the CPU backend is fully integrated.
- **Outstanding items.**
  - **Configuration reconciliation (⚠️).** `RendererSessionProvider` still uses fallback metrics forever. We need a feedback loop (first-frame metadata, measurement hook, helper) so renderer-provided metrics update `renderer.configure`.
  - **Runtime swapping semantics (⚠️).** Changing `rendererConfig.runtime` after mount updates refs without remounting. Decide whether to document the runtime as immutable or automatically tear down/recreate the session.
  - **Finish CPU backend path (🚧).** Once the canvas renderer plugs into the registry, add coverage for backend switching (render output + response callbacks) and graduate the `/canvas` entry from “placeholder” status.
- **Docs.** The integration guide now mentions backend selection; the README and release notes should explicitly describe the default import vs. `/webgl` vs. `/canvas` story when the CPU backend lands.

---

## 4. Web Demo (`apps/web-demo`)

- **Terminal still missing (⚠️ Critical).** The demo handles AWS discovery and SigV4 signing but never mounts `<Terminal />`. Without it we can’t validate the full pipeline (SSH → runtime → renderer) or showcase the new response callbacks.
- **Transport bridge half-wired (🚧).** `useSshSession` now exposes `handleRuntimeResponse`, but no runtime feeds data into it. When the terminal mounts we must:
  1. Pipe inbound PTY bytes into `TerminalRuntime.writeBytes`.
  2. Forward `onRuntimeResponse` payloads over the WebSocket channel.
  3. Add an integration/smoke test to keep the wiring covered.

Until the demo exercises the stack end-to-end, regressions in transport↔runtime↔renderer integration can slip through.

---

## 5. Next Moves (status snapshot)

| Initiative | Status | Notes |
| --- | --- | --- |
| Renderer configuration helper | ⚠️ Outstanding | Ship a `deriveRendererConfiguration` helper and update React + other hosts to consume renderer-feedback metrics after mount. |
| CPU renderer reboot | 🛑 Blocked | Stand up a new CPU renderer implementation, then wire it through the TUI React canvas backend with parity tests and documentation. |
| Runtime response callbacks | ✅ Complete | VT runtime, renderers, and React all surface `onRuntimeResponse`. |
| Web demo wiring | ⚠️ Outstanding | Mount `<Terminal />`, bridge runtime responses to SSH, and add a smoke test. |
| Docs/spec refresh | 🚧 In progress | Update renderer spec, README, and release notes once the configuration helper and CPU backend are in place. |

---

**Summary:** The VT runtime and React bindings now deliver the “give me a terminal” experience (presets, structured responses, backend registry). To realise the full promise we still need a configuration helper, a production-ready CPU backend path, and a demo that exercises the entire stack. Closing those gaps will give consumers predictable ergonomics—choose a renderer, mount the component, and ship without extra glue.***
