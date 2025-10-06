# VT Input Reporting Modes

This document captures how the terminal runtime models host input reporting toggles and the sequences it emits when DEC private modes request pointer, focus, or bracketed paste feedback.

## Scope

- Pointer tracking (DECSET 1000/1002/1003) with X10 button, normal tracking, and any-motion tracking.
- Extended pointer coordinate encodings (DECSET 1005/1006) for UTF-8 and SGR modes.
- Focus in/out reporting (DECSET 1004).
- Bracketed paste mode (DECSET 2004).
- Reset interactions (RIS, DECSTR) and partial mode queries (DECRQM/DECRPM).

## Invariants

- Modes remain disabled by default. The runtime only switches state after the interpreter processes the corresponding CSI `?` sequence.
- Updates are idempotent: repeated `set`/`reset` sequences that do not change state produce no deltas.
- Pointer tracking reports only emit when the negotiated encoding supports the necessary coordinates. If the host requests a higher capability (e.g., SGR) without enabling tracking, the encoding flag is remembered but no sequences are generated until tracking is active.
- Focus and bracketed paste sequences are suppressed unless the remote explicitly enables their respective modes.

## State Exposure

The runtime extends `TerminalState` with:

- `input.pointer = { tracking: 'off' | 'button' | 'normal' | 'any-motion'; encoding: 'default' | 'utf8' | 'sgr' }`
- `input.focusReporting = boolean`
- `input.bracketedPaste = boolean`

Every change emits a `TerminalUpdate` so hosts can react (e.g., binding pointer listeners only when needed).

## Outbound Sequences

### Pointer Tracking

- **Encoding selection:**
  - `default` → legacy X10 and normal tracking (`CSI M ...` with 1-based columns/rows).
  - `utf8` → same as default but buttons/coords encoded as UTF-8 offsets per Xterm.
  - `sgr` → `CSI < b ; c ; r M/m` form with decimal button codes.
- **Button mapping:** Buttons 0/1/2 align with left/middle/right. Wheel up/down map to 64/65. Motion reuses the last button with `32` offset as per spec.
- **Modifier bits:** Shift/Alt/Ctrl map to 4/8/16 offsets before encoding.

### Focus Reporting

- Focus gain emits `CSI I`.
- Focus loss emits `CSI O`.

### Bracketed Paste

- Paste start emits `ESC[200~`.
- Paste end emits `ESC[201~`.
- Payload between the guards flows through the regular `write` path so the interpreter reflects pasted text locally.

## Reset Behaviour

- `RIS` clears all input reporting toggles back to defaults.
- `DECSTR (CSI ! p)` resets pointer tracking to `off` while preserving encoding flags mandated by VT220+. Focus and bracketed paste are cleared.
- `DECRQM` / `DECRPM` responses include the most recent values so remote peers can query mode state.

## Testing Notes

- Unit tests assert that each mode toggle updates both interpreter state and emitted deltas.
- Runtime tests confirm mode-specific host events produce the expected `response` payloads and that disabled modes suppress output.
- Additional coverage verifies reset flows and DECRPM reporting.
