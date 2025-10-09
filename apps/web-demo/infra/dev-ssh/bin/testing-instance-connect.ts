#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { TestingInstanceConnectStack } from '../lib/testing-instance-connect-stack'

const app = new cdk.App()

const stackName =
  app.node.tryGetContext('stackName') ?? 'mana-dev-ssh-testing'

const env: cdk.Environment | undefined =
  process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
    ? {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
      }
    : undefined

new TestingInstanceConnectStack(app, stackName, {
  description:
    'Mana testing EC2 instance dedicated to integration tests for Instance Connect.',
  env,
})
