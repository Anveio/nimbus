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

### TODO – VT220 compliance roadmap

- ~~**Implement SOS/PM/APC strings**: mirror the OSC/DCS buffering for `ESC X`, `ESC ^`, `ESC _` (and their C1 single-byte forms). Emit a dedicated dispatch event and support CAN/SUB cancellation and BEL/ST termination.~~ ✅
- **Complete C1 coverage**: map VT220-relevant C1 controls (NEL, IND, RI, SS2/SS3, HTS, etc.) to structured events in `spec` mode while keeping `escaped/execute/ignore` fallbacks.
- **String length limits**: introduce configurable caps (default to VT220-safe values) for OSC/DCS/SOS payloads to avoid runaway buffers.
- **Default parser options**: codify VT220 defaults (`c1Handling: 'spec'`, 7/8-bit acceptance, CSI default parameter behaviour) and document deviations.
- **DEC control tests**: add fixtures for common VT220 sequences (DECRST/DECSET, DA/DA2, DECSLRM/DECSSTBM, Sixel DCS shell) to ensure the parser preserves parameters and intermediates.

### Inspiration from Ghostty

Ghostty Parser Architecture (Terminal/Parser.zig, parse_table.zig)

Ghostty keeps the DEC/VT state machine in a table-driven parser. parse_table.zig generates a [256][State]Transition array at compile time: each incoming byte and current state look up a destination state plus a primitive “transition action” (print, execute, collect, dispatch, ignore, etc.).
Parser.zig feeds bytes through that table and translates low-level actions into higher-level events (print, execute, csi_dispatch, osc_dispatch, dcs_hook/put/unhook, and dedicated APC state transitions). The parser returns an Action union so the terminal dispatcher can respond immediately to each event.
“Anywhere” transitions (CAN/SUB, ESC, CSI, DCS, OSC, SOS/PM/APC) are encoded centrally, ensuring cancellation and introducers work regardless of the current state.
CSI parameters support both ; and : separators, matching modern SGR semantics. Parameters are stored in reusable buffers with explicit separator metadata.
OSC / DCS / APC Handling

OSC parsing is delegated to osc.zig, which categorises common escape numbers (window title, clipboard, prompt markers, color ops, kitty, etc.). It assembles the payload incrementally and exposes typed commands, abstracting the text-processing complexity.
DCS streams use dcs_hook/dcs_put/dcs_unhook: the parser collects parameters and intermediates, then passes through raw payload bytes (with BEL or ESC \ termination, CAN/SUB cancellation) so higher layers can decode protocols like Sixel or DECSLRM.
SOS/PM/APC strings are handled exactly like OSC: enter string state, buffer data, terminate on BEL/ST, emit start/put/end actions. APC is used by Ghostty for hyperlinks and shell integration.
Terminal State (Terminal.zig and related)

The terminal keeps two Screen instances (primary/alternate), a Tabstops structure, cursor/mode flags, palette state, mouse handling, and selection metadata.
modes.zig, cursor.zig, Tabstops.zig, etc., reflect DEC private modes and settings, storing both boolean modes and structured information (mouse events, modifyOtherKeys, status line, etc.).
CSI/OSC/DCS events from the parser are routed into dedicated handlers (ansi.zig, csi.zig, dcs.zig, osc.zig) that update the terminal state—e.g., scrollback operations, palette updates, prompt tracking, kitty protocol, hyperlink management.
Inspiration for @packages/vt

Adopt a table-driven state machine: precompute [state][byte] transitions for speed and spec fidelity; this makes handling new states (SOS/PM/APC) straightforward and keeps control logic declarative.
Return structured events (print, execute, csi, osc, dcs, sos/pm/apc) instead of mutating state; let downstream consumers (like the eventual screen renderer) decide how to apply them.
Emulate Ghostty’s string handling: buffer OSC/DCS/SOS payloads, terminate on BEL/ESC \, allow cancellation, and surface typed payloads. For the VT220 roadmap this means adding SosPmApcDispatch events.
Mirror Ghostty’s separation of concerns: parser yields events, terminal (future tui package) interprets them, while specialised modules manage colors, modes, hyperlinks, etc.
Maintain per-feature configuration knobs akin to Ghostty’s build options: e.g., c1Handling, maximum string length, 7/8-bit acceptance, etc., so consumers can choose strict VT220 vs liberal behaviour.
Using Ghostty as a guide, we can finish SOS/PM/APC support, flesh out C1 semantics, and add configuration/testing infrastructure that aligns with real-world VT220 expectations while keeping the parser small, fast, and purely functional.