# Web Demo Infra Agent Charter

This charter guides how we evolve the web demo's infrastructure helpers. The goal is to ensure developers and automation can spin up or tear down supporting cloud resources with minimal friction.

## Mandate
1. **Zero-to-SSH fast path** – a developer cloning the repository should reach a working SSH-backed terminal with as few commands and context flags as possible. The helper scripts must encapsulate boilerplate (public IP detection, default stack names, etc.).
2. **CI-friendly provisioning** – continuous integration jobs should be able to reuse or recreate infra using environment variables only. Some additional complexity (explicit context overrides, stack reuse) is acceptable, but the flow must be documented and automated.
3. **Single-command cleanup** – every resource provisioned by our scripts must be releaseable with one command (`npm run infra -- --filter @mana/web-demo -- --destroy`) to avoid zombie instances or leaked costs.

## Current Scope
- `apps/web-demo/infra/dev-ssh`: CDK stack (Amazon Linux 2023 EC2 instance + security group) consumed by `npm run infra ...`.
- `scripts/run.mjs`: wrapper that resolves context parameters, opens security groups to the caller’s IP, and forwards commands to `npx cdk`.

## Guidelines
- **Local defaults**: leverage environment variables (`MANA_DEV_SSH_*`) so developers rarely pass `--context` flags manually.
- **CI overrides**: document required environment variables in `docs/aws-dev-target.md` and ensure the wrapper script respects them without additional prompts.
- **Idempotent state**: stacks must be safe to reapply (e.g., rerunning deploy should reconcile drift without manual steps).
- **Ownership**: keep infra code colocated with the app it serves; cross-app reuse belongs in shared constructs.

## TODO / Backlog Signals
- Add optional EIP or SSM Session Manager support for environments that can’t open port 22 publicly.
- Explore tagging conventions so multiple developers/CI jobs can identify their stacks easily.
- Investigate automated nightly cleanup for shared accounts (event-driven cleanup using stack name patterns).
