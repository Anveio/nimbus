#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation'
import {
  EC2Client,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2'
import { resolveInstanceTarget, resolveRegion } from '../lib/instance-connect-publisher'

const CACHE_DIR = '.mana'
const CACHE_FILE = 'testing-instance.json'

interface CliOptions {
  readonly write?: boolean
  readonly clear?: boolean
  readonly stackName?: string
  readonly region?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--write') {
      options.write = true
    } else if (arg === '--clear') {
      options.clear = true
    } else if (arg.startsWith('--stack-name=')) {
      options.stackName = arg.slice('--stack-name='.length)
    } else if (arg === '--stack-name') {
      options.stackName = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--region=')) {
      options.region = arg.slice('--region='.length)
    } else if (arg === '--region') {
      options.region = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unrecognized argument: ${arg}`)
    }
  }

  if (!options.write && !options.clear) {
    options.write = true
  }

  return options
}

function resolveRepoRoot() {
  return path.resolve(process.cwd(), '../../../..')
}

function getCachePath() {
  const repoRoot = resolveRepoRoot()
  return path.join(repoRoot, CACHE_DIR, CACHE_FILE)
}

async function writeCache(options: CliOptions) {
  const region = resolveRegion(options.region)
  if (!region) {
    throw new Error(
      'Unable to determine AWS region. Set AWS_REGION or pass --region.',
    )
  }

  const stackName =
    options.stackName ??
    process.env.MANA_TESTING_STACK_NAME ??
    process.env.MANA_DEV_SSH_STACK_NAME ??
    'mana-dev-ssh-testing'

  const target = await resolveInstanceTarget({
    region,
    stackName,
  })

  const cloudFormation = new CloudFormationClient({ region })
  const stackResult = await cloudFormation.send(
    new DescribeStacksCommand({ StackName: stackName }),
  )

  const testingUser =
    stackResult.Stacks?.[0]?.Outputs?.find(
      (output) => output.OutputKey === 'TestingUser',
    )?.OutputValue ?? 'mana-integ'

  const ec2 = new EC2Client({ region })
  const instanceDescription = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: [target.instanceId] }),
  )

  const instance = instanceDescription.Reservations?.[0]?.Instances?.[0]

  const cachePayload = {
    stackName: target.stackName,
    region: target.region,
    instanceId: target.instanceId,
    availabilityZone: target.availabilityZone,
    publicDnsName: target.publicDnsName ?? null,
    testingUser,
    stackTags: target.stackTags,
    instanceTags: instance?.Tags?.reduce<Record<string, string>>(
      (acc, tag) => {
        if (tag.Key) {
          acc[tag.Key] = tag.Value ?? ''
        }
        return acc
      },
      {},
    ),
    updatedAt: new Date().toISOString(),
  }

  const cachePath = getCachePath()
  mkdirSync(path.dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify(cachePayload, null, 2)}\n`)
  process.stderr.write(`Testing metadata cached at ${cachePath}\n`)
}

function clearCache() {
  const cachePath = getCachePath()
  try {
    rmSync(cachePath)
    process.stderr.write(`Removed testing metadata cache ${cachePath}\n`)
  } catch {
    process.stderr.write(`No testing metadata cache found at ${cachePath}\n`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.clear) {
    clearCache()
  }
  if (options.write) {
    await writeCache(options)
  }
}

await main()
