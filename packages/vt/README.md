# @packages/vt

Our mission is to deliver a zero-dependency VT core that fully covers
VT220 + ECMA-48 semantics while keeping the architecture modular enough
that VT500 or xterm extensions can be layered in as additional rule
modules when the product needs them. The public face of that core is a
terminal runtime that threads parser options, emulator quirks, and
interpreter state management into a single, spec-faithful entry point.

## What lives here?

- **State machine primitives** – TypeScript definitions for the VT500
  parser states, byte classes, parser events, and transition actions.
- **Table-driven classifier** – A hot-path byte classifier that assigns
  ECMA-48 categories (printable, parameter, intermediate, etc.) using
  bit flags so a single byte can belong to multiple roles when needed.
- **Terminal runtime** – `createTerminalRuntime` wires the parser and
  interpreter together, passing a consistent configuration surface to both
  layers so hosts only need to call `write` and read `snapshot`.
- **Parser scaffold** – A `createParser` factory that wires the state
  machine, manages mutable context (parameters, intermediates, private
  prefixes), and emits rich events to any sink when you need custom
  wiring or instrumentation.
- **Terminal interpreter** – A layered behaviour engine (`createInterpreter`)
  that consumes parser events, applies spec/emulator capabilities, and
  maintains terminal state while emitting incremental deltas for renderers.
- **Property-based tests** – Fast-check powered fuzz cases that validate
  the classifier across the entire 8-bit space, keeping us honest as we
  extend the state machine.

## Parser configuration

`createParser` accepts a small set of knobs so embedders can tune the
trade-offs between strict VT220 fidelity and more permissive behaviour:

- `spec` – choose a built-in DEC lineage (`'vt100'`, `'vt220'`, `'vt320'`,
  `'vt420'`, `'vt520'`, `'vt525'`). Each spec sets sensible
  defaults (C1 mode, 7/8-bit acceptance, string caps). Override any field to
  mix-and-match behaviours when necessary.
- `emulator` – optionally layer modern emulator quirks (currently `'xterm'`)
  on top of the chosen spec. The parser first loads the DEC defaults, then
  applies emulator overrides (larger OSC limits, 8-bit C1 handling), and
  finally respects any explicit overrides you pass in.
- `c1Handling` – choose how to treat C1 controls: the default `spec`
  routes VT220-recognised controls (NEL, IND, HTS, etc.) to structured
  events, while `escaped`, `execute`, and `ignore` mirror common xterm
  compat modes.
- `acceptEightBitControls` – defaults to `true` so both 7-bit (`ESC [`)
  and 8-bit (`0x9B`) introductions are recognised. Disable it when
  emulating very old 7-bit links.
- `maxStringLength` – historical single-value cap for OSC/DCS payloads.
  It still works, but consider the more granular `stringLimits`.
- `stringLimits` – per-channel caps (default `osc: 4096`, `dcs: 4096`,
  `sosPmApc: 4096`). OSC and SOS/PM/APC payloads are cancelled once the
  limit is hit. DCS payloads stream `DcsPut` chunks up to the limit and
  then drop into the `DcsIgnore` state so the terminator is swallowed
  without emitting a `DcsUnhook`.

## Runtime entry point

Most consumers should start with `createTerminalRuntime`. It returns a
fully wired `{ write, writeBytes, handleEvents, reset, snapshot }` bundle
that hides parser sinks while still exposing both the interpreter and the
underlying parser when advanced control is required. Pass your
`parser`/`capabilities`/`printer` options once and the runtime forwards
them to every layer so responses, scroll regions, and printer flows stay
in sync. `write` returns the aggregated `TerminalUpdate[]` diff emitted by
the interpreter, which you can hand straight to renderers.

If you need to tap directly into parser events (for logging, fuzzing, or
alternate interpreters) the raw `createParser` export remains available
via `import { parser } from '@mana/vt'` and calling `parser.create()`.

## Interpreter behaviour

`createInterpreter` remains available when you want to build a custom
pipeline around parser events. Feed every `ParserEvent` into the
interpreter to maintain an in-memory terminal model. The interpreter
tracks cursor position, screen buffers, SGR attributes, and scrollback,
emitting `TerminalUpdate`s (`cells`, `cursor`, `clear`, `scroll`, etc.) so
renderers can update incrementally. By initialising both parser and
interpreter with the same `spec`/`emulator` options—something the runtime
handles automatically—downstream consumers get a consistent capability
bundle whether they target classic VT220 semantics or modern xterm
behaviour.

Hitting any string limit leaves previously dispatched data untouched but
guarantees the parser will not buffer unbounded payloads – a critical
guard for browser environments where each terminal tab may host
untrusted programs.

## Glossary

| Term | Meaning |
| ---- | ------- |
| **CSI** | *Control Sequence Introducer*. Begins with `ESC [` (or the C1 single byte `0x9B`). Encodes operations like cursor moves and SGR styling via numeric parameters, optional intermediates (`0x20-0x2F`), and a final byte (`0x40-0x7E`). |
| **OSC** | *Operating System Command*. Begins with `ESC ]` / `0x9D`, carries free-form text terminated by BEL (`0x07`) or ST (`ESC \`). Used for window titles, clipboard, etc. |
| **DCS** | *Device Control String*. Starts with `ESC P` / `0x90`. Similar structure to CSI but supports streaming binary payloads between `DcsHook`/`DcsPut`/`DcsUnhook` events. |
| **C0 / C1** | Control character sets. C0 covers `0x00-0x1F`, C1 covers `0x80-0x9F`. Many states treat these differently (execute vs ignore). |
| **Intermediate bytes** | Bytes in `0x20-0x2F` that qualify a control sequence (e.g. `ESC ( 0` for charset selection). |
| **Parameters** | Bytes `0x30-0x3F` that encode numeric values separated by `;`. Stored in the parser context before dispatch. |
| **Final byte** | The terminating byte `0x40-0x7E` that determines which control function to execute. |
| **Private prefix** | Optional bytes like `?` or `>` immediately after the introducer; switch the semantic meaning of a CSI sequence. |
| **ST** | *String Terminator*. The two-byte escape `ESC \` (`0x1B 0x5C`) that ends OSC/DCS/PM/APC strings (BEL can also terminate OSC). |

## How the parser is structured

1. **Byte Classification** – Every incoming byte passes through
   `classifyByte`, which returns bit flags for all matching classes. This
   lets the state machine ask quick yes/no questions like “is this a CSI
   parameter?” without branch explosions.
2. **Transition Table (planned)** – Each `ParserState` will map byte
   categories to transitions that specify the next state and a list of
   primitive `Action`s (collect parameter, dispatch CSI, etc.) based on
   the VT500 diagram.
3. **Mutable Context** – The parser keeps a small context object holding
   the current state, accumulated parameters/intermediates, private
   prefix flags, and any buffered string data. Actions read/write this
   context to build the final event payloads.
4. **Event Emission** – Instead of mutating screen state directly, the
   parser emits `ParserEvent`s (`Print`, `Execute`, `CsiDispatch`,
   `OscDispatch`, `DcsHook` …) to a user-provided sink. This keeps the
   parser transport-agnostic and easy to test.
5. **Consumers** – Downstream code (e.g., the TUI renderer) listens to
   events and updates terminal buffers, cursor positions, and mode flags
   accordingly. Because events are immutable and well-typed, they work
   nicely with Effect streams or any reactive architecture.

## Writing a terminal parser – a quick mental model

1. **Start in `ground`** – Treat bytes as printable text unless they’re
   control characters. Printable bytes become `Print` events.
2. **Handle control introductions** – When you see `ESC`, switch to the
   `escape` state. The following byte(s) decide whether you’re entering a
   CSI, OSC, DCS, or returning to ground.
3. **Collect parameters/intermediates** – While in states like
   `csi_param` or `csi_intermediate`, push digits and intermediates into
   buffers. Semicolons (`;`) separate parameters; moving to the final
   byte triggers a dispatch.
4. **Dispatch on the final byte** – Once a final byte arrives, emit a
   `CsiDispatch` event containing the prefix, intermediates, and parsed
   parameters. Reset context to prepare for the next sequence.
5. **Process string-type sequences** – OSC/DCS/PM/APC require buffering
   arbitrary data until BEL or ST arrives. Emit start (`DcsHook`),
   streaming (`DcsPut`), and end (`DcsUnhook`) events so consumers can
   manage their own buffers.
6. **Always fall back safely** – Unknown sequences should funnel into
   ignore states without crashing the parser. The transition table will
   include `Ignore` actions and bounded buffers to maintain robustness.

## UTF-8 handling

- **Streaming friendly** – The parser defers emitting `Print` events until a
  multibyte sequence is complete, so a rune that is split across consecutive
  `write` calls still arrives as a single payload downstream.
- **Boundary aware** – Control characters (`ESC`, CAN/SUB, etc.) force any
  pending UTF-8 lead bytes to resolve to `U+FFFD`, ensuring the interpreter’s
  `TextDecoder` never remains stuck waiting for continuations after mode
  switches or cancelled sequences.
- **Error recovery** – Stray continuation bytes, invalid lead bytes, and
  truncated sequences are normalised to `U+FFFD` while the parser keeps the
  offending byte stream moving forward. No byte ever wedges the parser in an
  inconsistent state.
- **Spec updates first** – New UTF-8 behaviours must be reflected in the
  README/AGENTS docs before adding tests; the Vitest suite now covers happy
  paths, chunked writes, and malformed inputs so regressions surface quickly.

## VT100 coverage

- **Charset designation** – `ESC ( B`, `ESC ( 0`, and matching SO/SI controls
  toggle G0/G1 tables, with DEC Special Graphics translated to modern Unicode
  line-drawing glyphs.
- **Screen editing** – `ICH`, `DCH`, `IL`, `DL`, and `ECH` now mutate the
  active buffer, respecting margins and scroll regions so VT100 editor flows
  behave as expected.
- **Mode toggles** – DEC private modes (`DECCOLM`, `DECAWM`, `DECOM`, `DECCKM`,
  `DECSCLM`, `DECSCNM`, `DECARM`, `DECTCEM`) update interpreter state, including
  80/132 column rebuilds with fresh tab stops.
- **Diagnostics & reset** – `DECALN` (`ESC # 8`) paints the alignment pattern
  and `RIS` (`ESC c`) returns the terminal to a clean slate without leaving
  dangling parser state.

## VT320 roadmap

- Primary and secondary device attribute reports (`DA`/`DA2`) for `spec: 'vt320'`
  resolve to the DEC-documented signatures (`ESC[?62;1;2;6;7;8;9c` and
  `ESC[>62;1;2c`).
- Control function toggles `S7C1T`/`S8C1T` (`CSI ? 66 h/l`) switch the interpreter
  between 7-bit and 8-bit C1 transmission so outgoing responses match the
  negotiated mode.
- National Replacement Character Sets (NRCS) designate through the existing
  ISO-2022 machinery; glyph translation tables cover United Kingdom, German,
  French, and other VT320 sets.
- See `docs/vt320.md` for definitive test notes and spec references before
  extending behaviour or adding new fixtures.

## Development workflow

```bash
# Run unit + fuzz tests
cd packages/vt
npm exec vitest run

# Collect coverage (istanbul/text + lcov)
npm run test:coverage
```

The parser implementation is still under construction; contributions to
flesh out the transition table, event sink tests, or additional fixtures
are welcome. Always extend the fuzz corpus when adding new behaviour to
catch regressions against the VT500 spec.
