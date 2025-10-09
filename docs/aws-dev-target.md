# AWS Dev SSH Target

This guide explains how to stand up a real Amazon Linux 2023 host for terminal testing/development. The stack is intentionally minimal—create it when you need it, tear it down when you are finished.

## Prerequisites
- AWS account with permissions to manage EC2 instances, security groups, key pairs.
- IAM permission to call `ec2-instance-connect:SendSSHPublicKey` (granted to the AWS principal executing the helper script).
- AWS CLI configured (`aws configure`).
- Node.js ≥ 18 (already required by the repo).
- Existing EC2 key pair **name** in the target region (or create one with `aws ec2 create-key-pair`).
- Your public IP address (e.g. `curl https://checkip.amazonaws.com`).

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
