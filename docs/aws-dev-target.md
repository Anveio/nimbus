# AWS Dev SSH Target

This guide explains how to stand up a real Amazon Linux 2023 host for terminal testing/development. The stack is intentionally minimal—create it when you need it, tear it down when you are finished.

## Prerequisites
- AWS account with permissions to manage EC2 instances, security groups, key pairs.
- AWS CLI configured (`aws configure`).
- Node.js ≥ 18 (already required by the repo).
- Existing EC2 key pair **name** in the target region (or create one with `aws ec2 create-key-pair`).
- Your public IP address (e.g. `curl https://checkip.amazonaws.com`).

## Bootstrap
```bash
cd infra/aws/dev-ssh
npm install
```

## Deploy
```bash
npx cdk deploy \
  --context keyName=<YOUR_KEY_PAIR_NAME> \
  --context allowedIp=<YOUR_PUBLIC_IP/32> \
  --context stackName=mana-dev-ssh
```

Optional context:

| Key | Default | Notes |
| --- | --- | --- |
| `instanceType` | `t3.micro` | Override for different sizing. |
| `arch` | `x86_64` | Use `arm64` for Graviton (ensure key type matches). |
| `vpcId` | default VPC | Use specific VPC if required. |

Outputs include the instance ID, public DNS, and IP.

## Connect
```bash
ssh -i <PATH_TO_PRIVATE_KEY> mana@<PUBLIC_DNS>
```

> The bootstrap script seeds `/etc/motd` and creates the `mana` user. Update `infra/aws/dev-ssh/lib/user-data.sh` with your public key **or** push a key after launch using `aws ec2-instance-connect send-ssh-public-key`.

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
npx cdk destroy --context keyName=<...> --context allowedIp=<...>
```

Always destroy instances when you’re done to avoid extra cost.
