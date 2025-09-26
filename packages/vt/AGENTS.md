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

## 2024-10-17 – CSI guard rails

- Added bounds checking to CSI parsing (parameter count, intermediate count, and integer overflow) with fallbacks into the `CsiIgnore` state per ECMA-48 guidance.
- Implemented cancellation handling for CAN/SUB and ESC re-entry while parsing CSI, ensuring the parser safely returns to `ground` without emitting spurious events.
- Expanded unit coverage to include overflow, cancellation, and repeated prefix edge cases; improved invariants in test helpers for clearer failures.
- Coverage now stabilises around 76% lines on `parser.ts`, paving the way to tackle OSC/DCS states next.

## 2024-10-17 – OSC capture

- Implemented OSC string handling (BEL / ST terminators, CAN/SUB cancellation, ESC `]` and 0x9D introducers) with references to ECMA-48 §8.3.92.
- Added buffering helpers and new parser context fields to track OSC state while preventing accidental ST embedding.
- Extended parser tests to assert BEL/ST termination, 8-bit introducers, and cancellation behaviour; coverage climbed to ~78% lines / 77% branches for `parser.ts`.

## 2024-10-17 – DCS pass-through

- Wired up DCS entry/param/intermediate/passthrough states, emitting `DcsHook`, `DcsPut`, and `DcsUnhook` events per ECMA-48 §8.3.115, including CAN/SUB cancellation.
- Added buffered streaming for DCS payloads with ESC `\` / ST termination and 8-bit introducer support, plus guardrails for overflow.
- Expanded Vitest coverage to include hook/cancel flows and 8-bit DCS sequences.
- Backfilled tests that hit every CSI/DCS transition (overflow, ignore, cancellation, ESC re-entry) so parser coverage exceeds 85% lines/branches.
