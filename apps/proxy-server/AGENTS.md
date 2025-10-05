# Proxy Server Agent Charter

This charter directs development of the WebSocket ⇄ TCP bridge. Update it whenever security posture, transport contracts, or operational rituals shift.

## Mandate
- Provide a minimal, hardened gateway that translates browser WebSocket traffic into TCP streams suitable for SSH servers.
- Enforce AWS-grade security practices: authentication hooks, rate limits, observability, and audit-ready logging.
- Remain infrastructure-agnostic so the same binary runs locally, in containers, or behind AWS load balancers.

## Boundaries & Dependencies
- Lives inside `apps/proxy-server`; owns HTTP/WebSocket listeners, TCP socket plumbing, and policy enforcement.
- Does not implement SSH semantics—raw bytes flow between client and target. Protocol logic stays in `@mana/protocol` or upstream hosts.
- Integrates with `apps/simulated-instance` for development but must be configurable for arbitrary SSH endpoints in production.

## Design Pillars
- **Security first**: Mutual TLS, origin checks, authentication tokens, and configurable ACLs should wrap every connection path.
- **Backpressure aware**: Stream data with flow control, buffering limits, and timeouts to prevent resource exhaustion.
- **Observability**: Emit structured logs/metrics (connection lifecycle, byte counts, errors) compatible with AWS CloudWatch and local debugging.
- **Resilience**: Handle reconnects, abrupt TCP resets, and WebSocket close codes gracefully; expose health checks for orchestration.
- **Extensibility**: Modularise policy layers (auth, rate limiting, audit) so future requirements (e.g., per-tenant routing) slot in cleanly.

## Testing Doctrine
- Unit/integration: Use Vitest (or Node-based harnesses) with socket mocks to validate upgrade flows, framing, and policy decisions.
- End-to-end: Drive Playwright or npm scripts that exercise full browser → proxy → simulated instance handshakes; capture transcripts for regression.
- Security tests: Add chaos/boundary cases (oversized frames, slow loris, malformed packets) to ensure graceful rejection.
- Type & lint gates: `npm run typecheck` / `npm run lint` at repo root before merging.
- Documentation cadence: Update `docs/proxy-server` (to author) for new policies, config flags, or deployment guidance.

## Active Focus / Backlog Signals
- Implement authentication/authorization hooks (signed tokens, IP allowlists) before exposing the proxy beyond local dev.
- Add per-connection metrics (latency, throughput) and structured logging with unique request IDs.
- Support configurable SSH targets (host, port, ALB/ELB endpoints) via environment-driven config.
- Introduce rate limiting and idle timeouts to prevent abuse.
- Package container images and AWS deployment blueprints (ECS/Fargate/Lambda) once security posture is defined.

## Collaboration Rituals
1. Verify whether new behaviour belongs in the proxy versus protocol or host layers.
2. Propose strategy, secure approval, and follow docs/specs → tests → implementation flow.
3. Run unit/integration suites plus targeted end-to-end smoke (browser ↔ proxy ↔ simulated instance) before shipping.
4. Log security decisions, deployment changes, and discovered risks in the memory bank with dates.

## Memory Bank
### 2025-09-30 – Charter established
Authored the proxy server charter capturing security mandate, observability goals, testing cadence, and backlog items (auth hooks, metrics, configurability).
