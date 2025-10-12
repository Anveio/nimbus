#!/usr/bin/env node
import process from 'node:process'
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
  paginateListStacks,
  waitUntilStackDeleteComplete,
} from '@aws-sdk/client-cloudformation'
import { OWNER_ENV_KEYS, ownerFromEnvironment } from '../lib/tags'

interface CliOptions {
  readonly region?: string
  readonly owner?: string
  readonly dryRun?: boolean
  readonly wait?: boolean
  readonly purpose?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: Mutable<CliOptions> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--owner') {
      options.owner = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--owner=')) {
      options.owner = arg.slice('--owner='.length)
    } else if (arg === '--region') {
      options.region = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--region=')) {
      options.region = arg.slice('--region='.length)
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--wait') {
      options.wait = true
    } else if (arg === '--purpose') {
      options.purpose = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--purpose=')) {
      options.purpose = arg.slice('--purpose='.length)
    } else {
      throw new Error(`Unrecognized argument: ${arg}`)
    }
  }
  return options
}

function resolveRegion(option?: string) {
  return (
    option ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.CDK_DEFAULT_REGION ??
    null
  )
}

async function collectStacks(client: CloudFormationClient) {
  const stackNames: string[] = []
  const paginator = paginateListStacks({ client }, {})
  for await (const page of paginator) {
    for (const summary of page.StackSummaries ?? []) {
      if (
        summary.StackStatus &&
        summary.StackStatus.endsWith('_COMPLETE') &&
        summary.StackStatus !== 'DELETE_COMPLETE' &&
        summary.StackName
      ) {
        stackNames.push(summary.StackName)
      }
    }
  }
  return stackNames
}

async function filterStacksByTag(
  client: CloudFormationClient,
  stackNames: string[],
  owner: string,
  purpose?: string,
) {
  const matches: Array<{ name: string; tags: Record<string, string> }> = []
  for (const name of stackNames) {
    const describe = await client.send(
      new DescribeStacksCommand({ StackName: name }),
    )
    const stack = describe.Stacks?.[0]
    if (!stack?.Tags) {
      continue
    }
    const tags = stack.Tags.reduce<Record<string, string>>((acc, tag) => {
      if (tag.Key) {
        acc[tag.Key] = tag.Value ?? ''
      }
      return acc
    }, {})
    if (tags['mana:owner'] !== owner) {
      continue
    }
    if (purpose && tags['mana:purpose'] !== purpose) {
      continue
    }
    matches.push({ name, tags })
  }
  return matches
}

async function deleteStacks(
  client: CloudFormationClient,
  stacks: Array<{ name: string; tags: Record<string, string> }>,
  waitForDelete: boolean,
) {
  for (const stack of stacks) {
    process.stderr.write(`Deleting stack ${stack.name}\n`)
    await client.send(new DeleteStackCommand({ StackName: stack.name }))
    if (waitForDelete) {
      await waitUntilStackDeleteComplete(
        { client, maxWaitTime: 600 },
        { StackName: stack.name },
      )
    }
  }
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  const region = resolveRegion(cliOptions.region)
  if (!region) {
    throw new Error(
      'Unable to determine AWS region. Set AWS_REGION or pass --region.',
    )
  }

  const owner = (cliOptions.owner ?? ownerFromEnvironment()).trim()
  if (!owner.length) {
    throw new Error(
      `Unable to resolve owner from environment. Set one of ${OWNER_ENV_KEYS.join(', ')} or pass --owner.`,
    )
  }

  const client = new CloudFormationClient({ region })
  const stackNames = await collectStacks(client)
  const stacks = await filterStacksByTag(
    client,
    stackNames,
    owner,
    cliOptions.purpose,
  )

  if (stacks.length === 0) {
    process.stderr.write('No stacks matched the provided tag filters.\n')
    return
  }

  process.stderr.write(
    `Matched stacks: ${stacks.map((stack) => stack.name).join(', ')}\n`,
  )

  if (cliOptions.dryRun) {
    process.stderr.write('Dry run enabled, not deleting stacks.\n')
    return
  }

  await deleteStacks(client, stacks, cliOptions.wait ?? false)
}

void (async () => {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
})()
