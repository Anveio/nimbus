# ECMA-48 Implementation Roadmap (Foundations)

This document breaks the ECMA-48 plan into concrete engineering tasks for the
`@packages/vt` parser. Each item is tagged with the relevant clause(s) from the
specification.

## Phase A – Byte Stream Semantics

- **A1. Byte classification audit** – ensure `classifyByte` recognises every
  byte class defined in ECMA-48 §5.2 (C0, C1, GL/GR, locking shifts, single
  shifts, string terminators). Output: exhaustive unit tests + table entries.
- **A2. 7-bit vs 8-bit introducers** – support both ESC-prefixed and single-byte
  C1 forms for CSI (ESC `[`, 0x9B), OSC (ESC `]`, 0x9D), DCS (ESC `P`, 0x90),
  SOS/PM/APC (ESC `X`, `^`, `_`, 0x98/0x9E/0x9F). Reference: §8.1, §8.3.
- **A3. Limits & defaults** – encode parameter defaults and numeric bounds from
  §6.6 (e.g. missing CSI parameters default to 1 unless stated otherwise;
  parameter list length recommendations). Create constants + validation helpers.

## Phase B – State Machine Core

- **B1. Transition table** – implement the Annex B state diagram with an
  explicit table covering `ground`, `escape`, `escape intermediate`, `CSI entry`,
  `CSI param`, `CSI intermediate`, `CSI ignore`, `DCS entry`, `DCS param`,
  `DCS intermediate`, `DCS ignore`, `DCS passthrough`, `OSC string`, and
  `SOS/PM/APC string` states.
- **B2. Action handlers** – implement primitives for `print`, `execute`,
  `collect`, `dispatch`, `hook/put/unhook`, `osc_put`, `ignore`, `clear`, etc.,
  mutating the parser context or emitting events as required.
- **B3. Error tolerance** – follow §5.8 guidance on handling malformed control
  sequences (e.g. aborting, ignoring, or substituting). Define policies for
  parameter overflow, unterminated strings, and unsupported functions.

## Phase C – Event Model & Consumers

- **C1. Control dispatch table** – map CSI/DCS/ESC finals + intermediates to
  strongly-typed enums or handler identifiers so downstream layers can interpret
  meaning without string comparisons.
- **C2. String payload streaming** – expose iterables/streams for OSC and DCS
  payloads, respecting ST and BEL as terminators (§8.3.14, §8.3.92).
- **C3. Mode/state registry** – introduce an object to track private modes,
  tab stops, origin, wrap, etc., preparing for the terminal buffer layer.

## Phase D – Testing Strategy

- **D1. Clause-backed fixtures** – build a test harness that references the
  clause ID for each control sequence coverage (e.g. `CSI CUP` -> §8.3.21).
- **D2. Property-based fuzzing** – extend fast-check tests to generate random
  CSI/OSC sequences within spec limits and assert that parsing is idempotent
  (no context corruption, events emitted match expectations).
- **D3. Interop corpus** – record traces from a spec-compliant terminal (e.g.
  Ghostty, xterm) and replay them against the parser to compare emitted events.

## Phase E – Documentation & Validation

- **E1. Coverage matrix** – maintain a table (README appendix) showing which
  ECMA-48 clauses are implemented, pending, or intentionally omitted.
- **E2. Developer guides** – produce examples demonstrating how to consume
  parser events to build a browser terminal, including error handling and
  performance tips.

> This document should be updated as phases complete or scope changes. Start by
> delivering Phase A + B, since they unblock the rest of the stack.
