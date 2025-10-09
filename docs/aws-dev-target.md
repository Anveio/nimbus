# AWS Dev SSH Target

This guide explains how to stand up a real Amazon Linux 2023 host for terminal testing/development. The stack is intentionally minimal—create it when you need it, tear it down when you are finished.

## Prerequisites
- AWS account with permissions to manage EC2 instances, security groups, key pairs.
- IAM permission to call `ec2-instance-connect:SendSSHPublicKey` (granted to the AWS principal executing the helper script).
- AWS CLI configured (`aws configure`).
- Node.js ≥ 18 (already required by the repo).
- Existing EC2 key pair **name** in the target region (or create one with `aws ec2 create-key-pair`).
- Your public IP address (e.g. `curl https://checkip.amazonaws.com`).
- An active AWS profile (export `AWS_PROFILE=<name>` or rely on `default`) with a configured default region. Run `aws sso login --profile <name>` or export credentials before invoking the infra helpers.

## First-time setup: bootstrap the CDK environment
The infra helpers detect missing bootstrap resources and run `cdk bootstrap` automatically the first time you deploy. We default the CloudFormation execution role to `arn:aws:iam::aws:policy/AdministratorAccess`; override via `MANA_CDK_EXECUTION_POLICIES` (comma-separated ARNs) if your org prefers a custom policy. If your credentials can’t assume the administrator role, run the printed command after logging into that permission set.

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
We do **not** manage long-lived SSH keys. Instead, issue a temporary ED25519 credential just-in-time:

```bash
aws configure get region || export AWS_REGION=<TARGET_REGION>
npm run infra -- --filter @mana/web-demo -- --publish-key -- --pretty > /tmp/mana-dev-ssh.json
```

The command:
- Generates a one-off key pair (never written to disk by default).
- Calls `ec2-instance-connect:SendSSHPublicKey` for the Mana EC2 instance.
- Emits JSON (to stdout) containing the OpenSSH private key, the authorized key, expiration timestamp (60 seconds), and SSH target metadata. Errors and guidance print to stderr.

Persist the private key to a **secure, short-lived** file to connect:

```bash
PRIVATE_KEY_PATH=/tmp/mana-dev-ssh.key
jq -r '.privateKey' /tmp/mana-dev-ssh.json > "$PRIVATE_KEY_PATH"
chmod 600 "$PRIVATE_KEY_PATH"
ssh -i "$PRIVATE_KEY_PATH" "$(jq -r '.user' /tmp/mana-dev-ssh.json)"@"$(jq -r '.publicDnsName' /tmp/mana-dev-ssh.json)"
```

> Instance Connect credentials expire 60 seconds after issuance. If the login window closes, request a fresh key.

## Run the live Instance Connect test
The infra package ships a Vitest suite that calls the real `SendSSHPublicKey` API. It is **skipped by default**. To opt in:

1. Deploy the testing stack (`npm run infra:testing-deploy`) so `.mana/testing-instance.json` exists.
2. Export `MANA_RUN_INSTANCE_CONNECT_TESTS=1`.
3. Execute `npm run test -- --filter @mana/web-demo-infra-dev-ssh` or call `npm run test` from `apps/web-demo/infra/dev-ssh`.

The test reuses the cached metadata, generates an ephemeral ED25519 key, and fails fast if AWS rejects the call.

## Connect
```bash
ssh -i "$PRIVATE_KEY_PATH" mana@<PUBLIC_DNS>
```

> The bootstrap script seeds `/etc/motd` and creates the `mana` user. No manual edits to `authorized_keys` are required; always use the Instance Connect helper above.

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
