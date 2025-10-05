# @mana/vt Agent Charter

This file anchors how we reason about the VT parser + interpreter stack. Treat it as a living contract—revise whenever new capabilities or risks emerge.

## Mandate
- Deliver a specification-faithful VT core (ECMA-48 + VT220 as the bedrock) that can be extended toward VT320/VT500/xterm behaviour without rewrites.
- Emit deterministic, declarative terminal diffs that downstream renderers and hosts can consume without inheriting parser state.
- Document every deviation from the canonical spec (e.g., user-friendly backspace, AWS security hardening) and gate it behind explicit adapters or flags.

## Boundaries & Dependencies
- Owns classification, state machines, interpreter deltas, and capability descriptors inside `packages/vt`.
- Exports typed surfaces for `@mana/tui-react`, `@mana/tui-web-canvas-renderer`, and future hosts. No browser APIs, no transport logic.
- Shares spec and roadmap context through `docs/` alongside per-feature specs that precede implementation and test work.

## Design Pillars
- **Spec-first core**: Encode ECMA-48/VT diagrams verbatim in transition tables and capability manifests; layer quirks via opt-in overlays.
- **Pure engines**: Keep parser/interpreter logic side-effect free. Mutable shells (React bindings, transports) adapt behaviour but do not mutate shared state.
- **Type precision**: Model parser events, terminal updates, and capability toggles with discriminated unions and branded primitives—no `any`, no unchecked casts.
- **Extensible modules**: New control sets, charsets, or reports are additive table rows or capability flags, not bespoke branches.

## Foundational Components
- Public surface for parser state, byte-class flags, and event payload unions lives in `src/types.ts` to keep downstream consumers honest.
- Transition descriptors (`src/internal/actions.ts`) and state rules (`src/internal/state-rules.ts`) describe the FSM declaratively; no hardcoded switch statements.
- `createParser` and `classifyByte` share context factories (`src/internal/context.ts`, `src/internal/char-class.ts`) so tests and embedders see identical state.
- Interpreter snapshots (`src/interpreter/state.ts`) expose terminal metrics, mode toggles, printer flags, and programmable strings that hosts surface to users.

## Public Runtime Surface
- `createTerminalRuntime` is the canonical entry point. It wires parser + interpreter, returning a stable `TerminalRuntime` façade that hides parser internals.
- Runtime write APIs (`write`, `writeBytes`) stay byte-stream focused; local UX should express intent via `dispatchEvent` or the bulk `dispatchEvents` helper when batching.
- `TerminalRuntimeHostEvent` is the sole host-facing command surface:
  - `cursor.*` events wrap interpreter navigation primitives and preserve selection semantics.
  - `selection.*` events manage user highlights and edits without requiring consumers to manually diff state.
  - `parser.*` events are the sanctioned escape hatch for advanced embedders that already traffic in parser events.
- The raw parser export is explicitly advanced usage—keep it around for diagnostics, but nudge hosts to the runtime events first.

## Testing Doctrine
- Unit: `npm exec vitest run` inside `packages/vt` for parser, classifier, and interpreter suites. Property-based coverage applies to classifier and CSI parsers.
- Integration: Pixel/e2e layers in other packages rely on deterministic updates from this core—breaking changes must coordinate spec + tests across packages.
- Type Discipline: `npm run typecheck` at the workspace root gates every VT change; keep ambient types strict.
- Specification Ritual: Write or amend the relevant spec document (`packages/vt/docs`) before altering code or tests—commit history should show spec → tests → implementation.

## Active Focus / Backlog Signals
- Fill soft-reset coverage: `ESC [ ! p` and related DECSTR toggles should reset interpreter state without requiring RIS; add Vitest + Playwright cases.
- Complete DSR table (3, 7, 8) and verify emitted responses; ensure terminal handles printer and macro status queries.
- Tighten parser fallbacks for legacy escapes (ESC 1/2 height controls, 7-bit SS2/SS3). Bytes must not leak into print events.
- Extend Playwright harness to cover printer/AUX toggles, soft reset, answerback flows, and ensure browser demos assert responses.

## Collaboration Rituals
1. Challenge intent; clarify whether a request belongs in the spec core or an adapter layer.
2. Propose an implementation strategy, secure approval, then modify code/tests/spec in that order.
3. Run unit suites plus any dependent integration/e2e tests impacted by interpreter semantics before shipping.
4. Capture meaningful findings (gaps, regressions, coverage updates) in this charter’s memory bank with dates for future archeology.

## Memory Bank
### 2025-09-30 – Charter refresh
Reframed the VT agent charter to mirror the root repository ethos, extracted foundational component notes into dedicated sections, and captured the outstanding backlog around soft reset, DSR coverage, and legacy escape handling.

### 2025-10-09 – Terminal runtime entry point
- Introduced `createTerminalRuntime` as the recommended API for consumers that just want a wired parser+interpreter pair. Keeps parser export available via a dedicated `parser.create` escape hatch for instrumentation or custom pipelines.
- Added Vitest coverage for runtime behaviours (print flow, byte writes, capability overrides, printer wiring, reset semantics) so regressions surface immediately when the wiring changes.
- Documentation now points newcomers at the runtime abstraction first, clarifying that the interpreter is the core product and the raw parser is an advanced tool.

### 2025-10-10 – Runtime host event contract
- Documented the `TerminalRuntimeHostEvent` union so downstream packages program against cursor/selection primitives instead of raw parser events.
- Marked `dispatchEvent` and the bulk `dispatchEvents` helper as the happy paths, with `parser.dispatch`/`parser.batch` as explicit power-user fallbacks.
- Upcoming refactors will route `@mana/tui-react` and renderer packages through the event surface, keeping interpreter state behind the runtime façade.

### 2025-09-29 – Printer controller stub
- Introduced `printer/controller.ts` with a default no-op controller so the interpreter can mirror output when printer modes engage.
- `TerminalInterpreter` now tracks printer flags, mirrors writes for `CSI 0/4/5 i` and `CSI ? 4/5/6 i`, and exposes state for React and browser harnesses.
- Vitest asserts controller toggles and mirroring; Playwright verifies DECID/ENQ and printer events end-to-end. Future work: real print sinks and DSR 3/7 responses.

### 2025-09-29 – VT100 coverage gaps (partial)
Identified remaining work: implement soft resets, printer/AUX toggles, DSR 3/7/8, programmable answerback, and parser ignore paths for legacy ESC sequences. Some items now resolved (printer toggles, answerback) but others remain open and tracked above.

### 2025-09-28 – VT320 capability notes
Documented DEC STD 070 signatures for DA/DA2, S7C1T/S8C1T toggles, and NRCS expectations. Updated VT roadmap to prioritise VT320-specific device reports and control toggles.

### 2024-10-17 – Control stream expansions
- Added OSC buffering and termination (BEL/ST, CAN/SUB) with ECMA-48 §8.3.92 references; tests confirm 7/8-bit introducers.
- Implemented DCS pass-through states emitting `DcsHook`/`DcsPut`/`DcsUnhook`, including cancellation flows and overflow guardrails; coverage surpassed 85% on `parser.ts`.

### 2024-10-17 – CSI guard rails
Bound parameter/intermediate counts, enforced overflow protection, and handled CAN/SUB/ESC cancellations returning to ground. Expanded tests for overflow and repeated prefixes.

### 2024-10-16 – Initial ECMA-48 wiring
Encoded the initial FSM (ground, escape, CSI entry/param/intermediate) emitting structured events. Added unit coverage for printable runs, C0 execution, escape dispatch, and CSI parsing for both 7- and 8-bit forms.

### Early scaffolding (undated)
- Sketched the public surface for parser state and byte-class flags so downstream modules understand event payloads.
- Created declarative action/transition descriptors and context factories to centralise parser bookkeeping.
- Implemented `classifyByte` helper returning bitwise category flags, enabling overlapping roles without ad-hoc branching.
- Seeded Vitest coverage for byte classification to lock semantics against the VT500 chart and prepared `createParser` for state-table driven development.
