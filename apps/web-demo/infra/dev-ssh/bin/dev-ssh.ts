#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { DevSshStack } from '../lib/dev-ssh-stack'

const app = new cdk.App()

const stackName = app.node.tryGetContext('stackName') ?? 'nimbus-dev-ssh-instance'

const env: cdk.Environment | undefined =
  process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
    ? {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
      }
    : undefined

new DevSshStack(app, stackName, {
  description:
    'Nimbus dev SSH target (ephemeral) - provides an EC2 instance configured for terminal testing.',
  env,
})
