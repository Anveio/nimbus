# @mana/websocket Implementation Roadmap — Phase 2

_Last updated: 2025-10-04T08:12:00Z_

## Focus

- Integrate the websocket transport with `@mana/ssh` client adapters across web and node runtimes.
- Expand protocol coverage to resume loops, telemetry, and policy enforcement.
- Harden interoperability tooling (conformance kit, doc updates, integration harness).

## Workstreams

1. **SSH Client Integration**
   - Author `sshClientAdapter` for web/node, mapping `Connection.openSession` to `@mana/ssh` session APIs.
   - Preserve resume state (channel id, resume key, SSH session metadata) alongside websocket resume tokens.
   - Surface SSH-specific diagnostics via the websocket `diagnostic`/`policy` buses for visibility.

2. **Resume & Reconnect Validation**
   - Build deterministic integration harness that simulates network drops and ensures SSH sessions survive resumes within TTL.
   - Add replay tests for credit windows post-resume to verify no duplicate data frames.

3. **Transport Backpressure & Visibility Hooks**
   - Wire WHATWG `bufferedAmount` and Node stream `writableLength`/`highWaterMark` into the flow controller pause reasons.
   - Implement document visibility/offline observers in the browser client; add tests to confirm credit pauses/resumes.

4. **Server Policy Enforcement**
   - Connect `ServerConnection` to `@mana/ssh` adapter (node) and enforce:
     - Origin allowlist and session caps (close with policy diagnostics when exceeded).
     - Control-message rate limiting with structured policy events.
     - Heartbeat/idle timeout handling and logging.
   - Document policy knobs in `PROTOCOL.md` and server README.

5. **Conformance Kit & Docs**
   - Deliver BYO-server conformance scripts covering handshake, flow control, data echo, and resume failure cases.
   - Update `technical-design-spec.md` and `PROTOCOL.md` with finalized message fields and resume token semantics.
   - Add developer guide for registering custom `WireProfile`s with safety considerations.

## Pre-flight Checklist

- [ ] Unit + integration suites (Vitest) green.
- [ ] `bun run lint` and `bun run typecheck` clean.
- [ ] E2E smoke extended to exercise SSH echo journey once adapters land.
- [ ] Roadmap kept current after each milestone.

