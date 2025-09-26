Scaffolding Result

Sketched the public surface for the VT core—parser states, byte-class bit flags, and event payload unions—so downstream modules know exactly what data flows through the machine (packages/vt/src/types.ts:6).
Introduced reusable action/transition descriptors to keep the upcoming state table declarative and easy to extend when we encode the VT500 diagram (packages/vt/src/internal/actions.ts:6).
Added a mutable context factory to centralise parser bookkeeping (params, intermediates, private flags) for consistent resets and test isolation (packages/vt/src/internal/context.ts:7).
Defined canonical byte range metadata and a classifyByte helper that returns bitwise category flags, letting us express overlapping roles like printable vs. final bytes without ad‑hoc conditionals (packages/vt/src/internal/char-class.ts:9, packages/vt/src/classifier.ts:9).
Exposed a createParser stub wired to a shared TextEncoder, ready for TDD: it preserves structure/state access today and will accept the first real transition loop next (packages/vt/src/parser.ts:4, packages/vt/src/index.ts:1).
Seeded Vitest coverage for byte classification to lock in the new flag semantics against the VT500 chart, preventing regressions as we flesh out transitions (packages/vt/test/classifier.test.ts:5).
Tests

cd packages/vt && bunx vitest run
cd packages/vt && bun run build
Next Steps

Populate the state/action tables that mirror the VT500 diagram and drive Parser.write off them.
Add fixtures for CSI/OSC/DCS dispatch to extend the TDD suite beyond classification once the transition engine lands.

---

## 2024-10-16 – Initial ECMA-48 state-machine wiring

- Added `docs/ecma48-foundation.md` to translate the ECMA-48 roadmap into concrete engineering phases (classification, state machine, dispatch, testing).
- Implemented the first slice of the parser FSM (`ground`, `escape`, `escape intermediate`, and `CSI entry/param/intermediate`) emitting `Print`, `Execute`, `EscDispatch`, and `CsiDispatch` events.
- Introduced unit tests that validate printable runs, C0 execution, ESC dispatch (including intermediates), and CSI parsing for both 7-bit and 8-bit introducers.
- Coverage now reports >70% branches for the parser, establishing a baseline before implementing DCS/OSC handling.

Next immediate goals: extend CSI handling to ignore/error states, add OSC/DCS streaming, and backfill clause-referenced fixtures per the new roadmap.
