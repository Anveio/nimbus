# Web Demo Infra Agent Charter

This charter guides how we evolve the web demo's infrastructure helpers. The goal is to ensure developers and automation can spin up or tear down supporting cloud resources with minimal friction.

## Mandate
1. **Zero-to-SSH fast path** – a developer cloning the repository should reach a working SSH-backed terminal with as few commands and context flags as possible. The helper scripts must encapsulate boilerplate (public IP detection, default stack names, etc.).
2. **CI-friendly provisioning** – continuous integration jobs should be able to reuse or recreate infra using environment variables only. Some additional complexity (explicit context overrides, stack reuse) is acceptable, but the flow must be documented and automated.
3. **Single-command cleanup** – every resource provisioned by our scripts must be releaseable with one command (`npm run infra -- --filter @mana/web-demo -- --destroy`) to avoid zombie instances or leaked costs.

## Current Scope
- `apps/web-demo/infra/dev-ssh`: CDK stack (general-purpose Amazon Linux 2023 EC2 instance with EC2 Instance Connect enabled) consumed by `npm run infra ...`.
- `apps/web-demo/infra/dev-ssh/lib/testing-instance-connect-stack.ts`: tagged EC2 stack dedicated to Instance Connect integration tests and the `mana-integ` user.
- `scripts/run.mjs`: wrapper that resolves context parameters, opens security groups to the caller’s IP, and forwards commands to `npx cdk`.
- `scripts/run-testing.mjs`: orchestrator for the testing stack that mirrors the main wrapper and refreshes metadata caches.
- `scripts/publish-key.ts`: utility that generates an ephemeral ED25519 key, signs an Instance Connect request, and returns the temporary credential material as JSON.
- `scripts/update-testing-cache.ts`: helper invoked after testing-stack deploys to persist metadata in `.mana/testing-instance.json`.
- `scripts/cleanup-tagged-resources.ts`: CLI that enumerates CloudFormation stacks tagged with `mana:*` keys and destroys them deterministically.
- `scripts/bootstrap.mjs`: wrapper that resolves credentials/profile information and runs `cdk bootstrap` for the active account/region.

## Guidelines
- **Local defaults**: leverage environment variables (`MANA_DEV_SSH_*`) so developers rarely pass `--context` flags manually.
- **CI overrides**: document required environment variables in `docs/aws-dev-target.md` and ensure the wrapper script respects them without additional prompts.
- **Ephemeral credentials**: always prefer EC2 Instance Connect for developer access. We do not persist SSH keys on disk or bake them into AMIs; clients must request fresh credentials per session (`npm run infra:publish-key` locally, equivalent automation in CI).
- **Tag discipline**: every stack/resource must carry `mana:owner`, `mana:purpose`, and `mana:repository` tags. Owners default from environment variables but must be override-able for shared accounts.
- **Testing parity**: keep the testing stack in lockstep with the dev stack (AMI selection, security posture) so integration tests exercise reality.
- **Bootstrap policy**: default CloudFormation execution policies to `arn:aws:iam::aws:policy/AdministratorAccess`; teams may override via `MANA_CDK_EXECUTION_POLICIES` if they maintain a scoped alternative.
- **Idempotent state**: stacks must be safe to reapply (e.g., rerunning deploy should reconcile drift without manual steps).
- **Ownership**: keep infra code colocated with the app it serves; cross-app reuse belongs in shared constructs.

## TODO / Backlog Signals
- Add optional EIP or SSM Session Manager support for environments that can’t open port 22 publicly.
- Investigate automated nightly cleanup for shared accounts (event-driven cleanup using stack name patterns).
