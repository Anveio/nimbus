# @packages/vt

Our mission is to deliver a zero-dependency VT parser that fully covers
VT220 + ECMA-48 semantics while keeping the architecture modular enough
that VT500 or xterm extensions can be layered in as additional rule
modules when the product needs them. In practice that means a clean,
data-driven core that emits rich events other packages (like `tui`) can
interpret to maintain terminal state.

## What lives here?

- **State machine primitives** – TypeScript definitions for the VT500
  parser states, byte classes, parser events, and transition actions.
- **Table-driven classifier** – A hot-path byte classifier that assigns
  ECMA-48 categories (printable, parameter, intermediate, etc.) using
  bit flags so a single byte can belong to multiple roles when needed.
- **Parser scaffold** – (Work in progress) a `createParser` factory that
  wires the state machine, manages mutable context (parameters,
  intermediates, private prefixes), and emits rich events to any sink.
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

## Development workflow

```bash
# Run unit + fuzz tests
cd packages/vt
bunx vitest run

# Collect coverage (istanbul/text + lcov)
bun run test:coverage
```

The parser implementation is still under construction; contributions to
flesh out the transition table, event sink tests, or additional fixtures
are welcome. Always extend the fuzz corpus when adding new behaviour to
catch regressions against the VT500 spec.
