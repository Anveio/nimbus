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