## Mission

Target full VT220 + ECMA-48 behaviour as the canonical baseline while keeping the parser architecture modular enough that VT500/xterm extensions can be layered in as additional rule modules when needed.

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

## 2025-09-27 – Gap analysis and emulator roadmap

- Behaviour layer currently ignores non-CSI events: OSC/PM/APC payloads, DCS streams, and SOS buffers never propagate beyond parser dispatch, so renderers cannot update titles, clipboard, hyperlinks, or graphics buffers (`packages/vt/src/interpreter/terminal-interpreter.ts:50`).
- Terminal attributes only expose bold plus 16-colour slots; missing faint/italic/underline/inverse/strikethrough and 256/truecolour tracking prevents high-fidelity renderers from matching xterm/kitty output (`packages/vt/src/interpreter/state.ts:3`).
- `TerminalUpdate` lacks hooks for palette changes, clipboard operations, cursor styling, mouse/reporting toggles, and diagnostics—downstream renderers see only print/cursor/scroll updates (`packages/vt/src/interpreter/delta.ts:15`).
- Emulator overlay table defines xterm only; kitty/iTerm2/Ghostty string limits and feature flags are absent despite roadmap requirements (`packages/vt/src/internal/emulator-quirks.ts:16`).
- Parser action descriptors stay unused scaffolding, making it harder to inject emulator-specific rules or diagnostics (`packages/vt/src/internal/actions.ts:6`).
- Test coverage stops at DEC-era control flow; no fixtures assert OSC 52/133/134, kitty graphics negotiation, or Sixel overflow handling (`packages/vt/test/*`).

Next steps

- Extend interpreter state + updates so OSC/DCS/SOS, palette shifts, and richer SGR attributes surface to renderers while maintaining Effect-friendly immutability boundaries.
- Introduce emulator overlays (xterm baseline retained, kitty added now) that coordinate parser string limits with interpreter feature flags and corresponding tests.
- Kitty emulator profile currently only relaxes string limits; dedicated kitty graphics/keyboard protocols remain to be implemented in parser/interpreter layers.
- Backfill Vitest coverage for the new behaviour to guard against regressions and document expected renderer-facing payloads.

<memory-bank>
### 2025-09-27
- Log gap analysis outcomes and prioritise interpreter surface expansion plus kitty emulator overlay.
- Planned work: surface OSC/DCS/SOS + extended SGR states, add kitty profile alongside xterm, and author targeted Vitest coverage.
</memory-bank>

### TODO – VT220 compliance roadmap

- ~~**Implement SOS/PM/APC strings**: mirror the OSC/DCS buffering for `ESC X`, `ESC ^`, `ESC _` (and their C1 single-byte forms). Emit a dedicated dispatch event and support CAN/SUB cancellation and BEL/ST termination.~~ ✅
- ~~**Complete C1 coverage**: map VT220-relevant C1 controls (NEL, IND, RI, SS2/SS3, HTS, etc.) to structured events in `spec` mode while keeping `escaped/execute/ignore` fallbacks.~~ ✅
- ~~**String length limits**: introduce configurable caps (default to VT220-safe values) for OSC/DCS/SOS payloads to avoid runaway buffers.~~ ✅
- ~~**Default parser options**: surface spec-aware parser defaults so `createParser({ spec: 'vt220' })` automatically sets `c1Handling: 'spec'`, 8-bit acceptance, and conservative string caps, while still allowing per-field overrides.~~ ✅
- **DEC control tests**: add fixtures for common VT220 sequences (DECRST/DECSET, DA/DA2, DECSLRM/DECSSTBM, Sixel DCS shell) to ensure the parser preserves parameters and intermediates, plus coverage for the new DCS overflow path (no `DcsUnhook` on guard-triggered cancellation).

### Roadmap ideas – 2025-09-27

- ~~**State-rule spec module**: Move the per-state byte-rule definitions into a standalone data module so the parser consumes a declarative spec instead of embedding rule construction logic.~~ ✅
- ~~**ByteFlag-driven descriptors**: Express rule predicates in terms of `ByteFlag` groupings / VT500 diagram semantics so the state specs read directly off the chart.~~ ✅
- **Behaviour layers**: Once the parser surface is declarative, layer VT220 semantics (DEC mode toggles, margins, etc.) as separate interpreters consuming the emitted events to keep responsibilities clean.
- **Emulator overlays**: Define per-emulator capability bundles (xterm, kitty, etc.) that sit atop DEC specs so parser/event layers can share consistent capability metadata.

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

## Technical approach – layered terminal stack

- **Motivation** – Real terminals are more than parsers. Users expect VT220 semantics (margins, origin mode, tab stops) and emulator conveniences (OSC 52 clipboard, mouse tracking). Keeping those duties in the parser would produce an unmaintainable monolith. A layered design lets us evolve each concern independently and ship consistent behaviour across devices.
- **Layering** –
  1. **Parser**: consumes bytes and emits `ParserEvent`s according to the DEC state diagram; configuration is driven by `resolveParserOptions`.
  2. **Behaviour/Interpreter**: ingests events, applies spec+emulator capabilities, and maintains terminal state (screen buffers, cursor, DEC modes, scrollback). It exposes read-only snapshots plus `TerminalStateDelta` diffs for consumers.
  3. **Presentation / Emulator features**: renders diffs (canvas, DOM, WebGPU) and hooks optional integrations (clipboard, hyperlinks, mouse). Emulator overlays such as xterm sit here, enabling features without mutating lower layers.
- **Configuration flow** – Spec defaults (vt100/vt220/…) merge with emulator overlays (xterm, kitty, …) before parser and interpreter initialisation. Both layers therefore share the same capability bundle—feature flags, default modes, string caps—which downstream components can query.
- **Implementation roadmap** –
  - Extend overlay metadata to publish capability descriptors (supported modes, OSC handlers, DCS expectations) instead of ad-hoc overrides.
  - Introduce a `TerminalInterpreter` with methods like `handleEvent(event): Iterable<TerminalStateDelta>` and `reset()`. Build the initial command set around VT220 semantics (cursor moves, SGR, DECSET/DECRST, margins, tab stops).
  - Define a compact diff format for screen updates (cell writes, scroll regions, mode toggles) so renderers can stay incremental.
  - Update the TUI package to wire bytes → parser → interpreter, listening for diffs to drive the UI, while exposing hooks for emulator-specific behaviours (clipboard, mouse, bracketed paste).
- **Long-term payoff** – Once this structure is in place, adding new emulators or advanced features becomes data-driven. We can attach mouse protocols, hyperlink handling, or sixel decoding without touching the parser, and we can share the capability descriptors with any runtime (web, native, WASM) that embeds the VT stack.

## 2024-10-19 – Behaviour layer scaffold

- Added `TerminalInterpreter` consuming `ParserEvent`s with support for cursor motion, SGR, tab stops, scroll regions, reverse index, and DEC private modes (DECOM/DECAWM/DECTCEM).
- Grounded terminal capabilities in shared spec/emulator descriptors so parser and interpreter stay in sync.
- Introduced interpreter deltas (`cells`, `cursor`, `scroll`, `mode`, etc.) so renderers can react incrementally while remaining agnostic of interior state.
- Laid the foundation for future DEC features (DECSC/DECRC already supported) and richer overlays by centralising tab stop management, margins, and autowrap handling in the interpreter.
- **Next steps**:
  - Complete VT220/VT3xx semantics (insert/delete line & char, DECCOLM 80/132, DECTABSR, full DECSET/DECRST catalogue).
  - Add scrollback and alternate screen buffers, plus saved state management.
  - Expand emulator overlays (kitty, iTerm2, Ghostty) and wire optional features (OSC 52, mouse reporting, hyperlinks).
  - Provide renderer-specific wrappers rather than a single universal TUI. The VT core + interpreter live in `@mana-ssh/vt`; React DOM rendering ships as `@mana-ssh/tui-react`, React Native will land in `@mana-ssh/tui-react-native`, and future canvas/WASM/native renderers can reuse the same event/update pipeline.

## 2025-10-02 – Selection APIs

- Added immutable `TerminalSelection` helpers (`areSelectionsEqual`, row-segment computations) and wired them into the public barrel for consumers.
- `TerminalInterpreter` now exposes `setSelection`, `updateSelection`, and `clearSelection`, emitting `selection:*` deltas while deduping redundant updates; snapshot state mirrors the latest selection.
- Vitest coverage verifies the new API surface alongside existing interpreter tests, giving downstream renderers a consistent way to drive highlights.

## 2025-10-06 – UTF-8 resilience

- Documented the parser’s UTF-8 contract in the README: chunked sequences stay buffered across writes, control boundaries force incomplete runes to resolve, and malformed byte patterns fall back to `U+FFFD` rather than wedging the state machine.
- Added Vitest scenarios for multi-byte prints, cross-write buffering, control-interrupted sequences, and malformed continuation bytes to lock in the desired behaviour.
- Refactored the parser runtime so printable handling tracks pending UTF-8 bytes, emits replacements on errors, and resets the accumulator whenever control flows flush the print buffer.
