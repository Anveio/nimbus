# Simulated Instance Agent Charter

This charter governs the containerised SSH target used for development and tests. Revise it whenever runtime support, security posture, or automation rituals change.

## Mandate
- Provide a reproducible Amazon Linux–based SSH server that mirrors AWS production expectations.
- Offer developer ergonomics (fast startup, deterministic credentials) while remaining configurable for CI pipelines and security audits.
- Serve as the canonical endpoint for end-to-end, integration, and interoperability testing of the Mana SSH stack.

## Boundaries & Dependencies
- Lives inside `apps/simulated-instance`; owns Docker/Finch orchestration, image build context, and runtime scripts.
- Exposes only SSH over TCP; higher-level protocol or UI logic belongs upstream.
- Depends on container daemons (Finch preferred, Docker supported). Scripts must detect and adapt to the active runtime.

## Design Pillars
- **Deterministic builds**: Dockerfile and build scripts must produce identical images across environments; pin package versions and capture SHA checksums when possible.
- **Security alignment**: Configure OpenSSH with AWS-aligned policies (crypto suites, banner, PAM settings) while keeping credentials test-friendly.
- **Operational ergonomics**: Fast boot via cached images, simple cleanup commands, and clear status messaging.
- **Extensibility**: Structure scripts to add alternate OS images or SSH configurations (e.g., FIPS mode, IPv6) without rewriting the harness.
- **Observability**: Emit logs/metrics (connection attempts, auth success/failure) to aid debugging of protocol tests.

## Testing Doctrine
- Unit/integration: Bun scripts should validate runtime detection, build steps, and cleanup flows (mock Dockerode interactions where practical).
- End-to-end: Playwright and proxy tests must target this instance to ensure realistic SSH behaviour under canvas/React demos.
- Health checks: Provide scripts to verify container readiness (port 22 open, banner match) before running dependent suites.
- Type & lint gates: `bun run typecheck`/`bun run lint` at repo root; keep orchestration code strongly typed.
- Documentation cadence: Update README/usage guides when adding new runtime requirements or credentials.

## Active Focus / Backlog Signals
- Implement automated health check script used by Playwright and CI pipelines prior to running terminal tests.
- Add support for configurable host keys and user accounts to simulate multi-tenant scenarios.
- Capture container logs/metrics for debugging (e.g., stream to stdout, provide `bun run logs`).
- Provide hardened mode (FIPS-approved ciphers only) to test strict security policies.
- Publish cleanup scripts that remove stale volumes/networks in addition to images/containers.

## Collaboration Rituals
1. Confirm whether feature requests belong in the simulated instance versus proxy/protocol layers.
2. Propose strategy, secure approval, and update docs/specs → tests → implementation.
3. Run orchestration scripts (`bun dev`, `bun run clean`), health checks, and dependent e2e tests after making changes.
4. Record runtime support decisions, security changes, and roadmap items in the memory bank with dates.

## Memory Bank
### 2025-09-30 – Charter established
Documented the simulated-instance mandate, runtime pillars, testing cadence, and backlog (health checks, configurable host keys, hardened mode).

