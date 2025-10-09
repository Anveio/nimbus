#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { DevSshStack } from '../lib/dev-ssh-stack.js'

const app = new cdk.App()

const stackName =
  app.node.tryGetContext('stackName') ?? 'mana-dev-ssh-instance'

new DevSshStack(app, stackName, {
  description:
    'Mana dev SSH target (ephemeral) - provides an EC2 instance configured for terminal testing.',
})
