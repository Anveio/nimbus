# AWS Dev SSH Target

This guide explains how to stand up a real Amazon Linux 2023 host for terminal testing/development. The stack is intentionally minimal—create it when you need it, tear it down when you are finished.

## Prerequisites
- AWS account with permissions to manage EC2 instances, security groups, key pairs.
- IAM permission to call `ec2-instance-connect:SendSSHPublicKey` (granted to the AWS principal executing the helper script).
- AWS CLI configured (`aws configure`).
- Node.js ≥ 18 (already required by the repo).
- Node.js ≥ 24 (all infra scripts run native TypeScript via `tsx` and rely on modern Node features).
- Existing EC2 key pair **name** in the target region (or create one with `aws ec2 create-key-pair`).
- Your public IP address (e.g. `curl https://checkip.amazonaws.com`).
- An active AWS profile (export `AWS_PROFILE=<name>` or rely on `default`) with a configured default region. Run `aws sso login --profile <name>` or export credentials before invoking the infra helpers.

## First-time setup: bootstrap the CDK environment
The infra helpers detect missing bootstrap resources and run `cdk bootstrap` automatically the first time you deploy. We default the CloudFormation execution role to `arn:aws:iam::aws:policy/AdministratorAccess`; override via `MANA_CDK_EXECUTION_POLICIES` (comma-separated ARNs) if your org prefers a custom policy. If your credentials can’t assume the administrator role, run the printed command after logging into that permission set.

Every automation assumes you’ll clean up when you’re done. Tagging, teardown scripts, and bootstrap auto-detection are there to make hygiene frictionless—lean on them so environments never linger.

## Deploy
From the monorepo root (after `npm install`):

```bash
export MANA_DEV_SSH_KEY_NAME=<YOUR_KEY_PAIR_NAME>    # run once per session
npm run infra -- --filter @mana/web-demo -- --deploy
```

The script automatically detects your current public IP and restricts the security group to it. To override contexts manually, set:

| Environment | Purpose |
| --- | --- |
| `MANA_DEV_SSH_ALLOWED_IP` | Custom CIDR (e.g. `203.0.113.4/32`). |
| `MANA_DEV_SSH_STACK_NAME` | Override stack name (`mana-dev-ssh-instance` by default). |

To inspect the synthesized template without deploying:

```bash
npm run infra -- --filter @mana/web-demo
```

Outputs include the instance ID, public DNS, and IP.

## Optional: deploy the testing stack
Provision the dedicated integration-test instance (tags `mana:purpose=instance-connect-testing`) when you need to exercise the live AWS path:

```bash
cd apps/web-demo
npm run infra:testing-deploy
```

The testing wrapper refreshes `.mana/testing-instance.json` with the stack metadata after every successful deploy. Destroy the stack with `npm run infra:testing-destroy`.

## Request an ephemeral key (EC2 Instance Connect)
Ephemeral keys are issued through the browser demo experience. Use the web UI to request access when you need to reach the dev host; the CLI helper has been intentionally retired.

## Run the live Instance Connect test
The infra package ships a Vitest suite that calls the real `SendSSHPublicKey` API. It is **skipped by default**. To opt in:

1. Deploy the testing stack (`npm run infra:testing-deploy`) so `.mana/testing-instance.json` exists.
2. Export `MANA_RUN_INSTANCE_CONNECT_TESTS=1`.
3. Execute `npm run test -- --filter @mana/web-demo-infra-dev-ssh` or call `npm run test` from `apps/web-demo/infra/dev-ssh`.

The test reuses the cached metadata, generates an ephemeral ED25519 key, and fails fast if AWS rejects the call.

## Wire into the proxy
Set environment variables for the WebSocket proxy or other transports:

```bash
export MANA_SSH_HOST=<PUBLIC_DNS>
export MANA_SSH_PORT=22
export MANA_SSH_USERNAME=mana
export MANA_SSH_KEY_PATH=<PATH_TO_PRIVATE_KEY>
```

## Tear Down
```bash
npm run infra -- --filter @mana/web-demo -- --destroy
```

Always destroy instances when you’re done to avoid extra cost.

To remove **all** tagged stacks for the current owner/account:

```bash
cd apps/web-demo
npm run infra:cleanup-tagged -- --dry-run        # preview
npm run infra:cleanup-tagged -- --wait           # delete and wait for completion
```

Both dev and testing stacks are tagged with `mana:owner=<resolved owner>` and `mana:purpose=<...>`; cleanup tooling filters on those tags so shared accounts stay tidy.
