# @nimbus/websocket Implementation Roadmap (v1)

_Last updated: 2025-10-04T07:58:11Z_

## Context

- Primary spec: [`technical-design-spec.md`](./technical-design-spec.md)
- Scope: protocol core, client/web, client/node, server/node surfaces outlined in Spec §§2–17.
- Tenets referenced: DX-first, Runtime honesty, Interoperability, Safety, Spec compliance (Spec §1).

This note sequences near-term workstreams required before code lands, with emphasis on the protocol core as the canonical semantic contract.

## 1. Protocol Core (Spec §4, §10, §13, Appendix A)

1. **Semantic schema lock-in** — _Complete_
   - Discriminated unions for control/data/diagnostic/policy messages and connection/channels land in `packages/websocket/src/protocol` with exhaustive guards and helper predicates.
   - Version markers (`proto: 1`, subprotocol `nimbus.ssh.v1`) branded in types; upgrade path reserved via profile registry.

2. **WireProfile contract** — _Complete_
   - Core `WireProfile` interface exported; default registry seeds `nimbus.v1`, `json-base64.v1`, `lenpfx.v1` with decode/encode parity tests.
   - Conformance fixtures exercised through vitest round-trip coverage.

3. **Flow-control spine** — _Complete (client/shared)_
   - Pure reducers for credit accounting with pause reasons (transport, visibility, offline) driving policy events.
   - Adaptive heuristics TBD; placeholder window targets (256KiB→2MiB) wired.

4. **Session & resume state machine** — _In progress_
   - Connection FSM implemented with diagnostics breadcrumbing heartbeats, resume attempts, and close taxonomy.
   - Resume token persistence wired for session/memory stores; resume negotiation tests pending.

5. **Diagnostics & policy events** — _Complete_
   - Diagnostic/policy buses fan out from protocol harness; client/server surfaces re-emit typed payloads.

6. **Testing scaffolding** — _Partial_
   - Vitest suite covers profiles, flow reducers, channel invariants, and harness behaviour.
   - Remaining work: resume loop simulations and BYO-server conformance script harness.

## 2. Client/Web (Spec §5, §6, §8, §9)

Status: _Happy-path implemented_

1. `connectWeb` exported with harnessed handshake/backoff/resume storage (session/memory/none).
2. Flow controller bridges credit grants to transport backpressure toggles; bufferedAmount integration TODO when real browser runtime present.
3. Diagnostics (`statechange`, `policy`, `diagnostic`) re-emit typed events.
4. Heartbeat scheduling + visibility hooks queued for next sprint.

## 3. Client/Node (Spec §5, §6, §8, §9, §15)

Status: _API parity achieved; transport nuances pending_

- Node `connect` mirrors web API, requires explicit `WebSocketImpl`; perMessageDeflate knobs stubbed.
- Backpressure integration and large-stream soak tests remain open.
- Diagnostics exposed for Electron main; piping to renderer to be designed with apps/terminal-web.

## 4. Server/Node (Spec §2, §6, §7, §11, Appendix B)

Status: _Skeleton online_

- Node server now instantiates `ServerConnection` per upgrade, replying to `hello`/`open`, queuing writes until credit arrives, and emitting diagnostics.
- Policy hooks for rate limits / origin-gates / heartbeats remain TODO.
- SSH adapter integration and resume reconciliation pending.

## Open Questions & Follow-ups

- Adaptive `windowTarget` heuristics need RTT measurement strategy—client-side, server-side, or negotiated?
- Resume token cryptography/entropy requirements (Spec §8.4) pending security review.
- Diagnostics integration with repo-wide telemetry schema (Spec §11 → apps/telemetry) to coordinate with `@nimbus/web` team.
- End-to-end resume/reconnect simulations (client ↔ server) and conformance kit orchestration outstanding.

## Next Actions

1. Wire server connection to `@nimbus/ssh` adapter scaffold; define channel lifecycle contract.
2. Add integration harness executing client ↔ server handshake/resume loops (deterministic sockets) and log coverage.
3. Implement backpressure adapters (WHATWG bufferedAmount, Node stream) feeding flow controller pause reasons.
4. Expand diagnostics to include structured policy events (rate limit, origin) and hook into repo telemetry once defined.
5. Document resume token format + security posture in `PROTOCOL.md` once crypto story finalized.
