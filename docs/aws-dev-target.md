# AWS Dev SSH Target

This guide explains how to stand up a real Amazon Linux 2023 host for terminal testing/development. The stack is intentionally minimal—create it when you need it, tear it down when you are finished.

## Prerequisites
- AWS account with permissions to manage EC2 instances, security groups, key pairs.
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

## Connect
```bash
ssh -i <PATH_TO_PRIVATE_KEY> mana@<PUBLIC_DNS>
```

> The bootstrap script seeds `/etc/motd` and creates the `mana` user. Update `apps/web-demo/infra/dev-ssh/lib/user-data.sh` with your public key **or** push a key after launch using `aws ec2-instance-connect send-ssh-public-key`.

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
