#!/usr/bin/env node
import process from 'node:process'
import { publishEphemeralKey } from '../lib/instance-connect-publisher'

interface CliOptions {
  readonly pretty?: boolean
  readonly stackName?: string
  readonly region?: string
  readonly comment?: string
  readonly osUser?: string
  readonly instanceId?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pretty') {
      options.pretty = true
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
    } else if (arg.startsWith('--comment=')) {
      options.comment = arg.slice('--comment='.length)
    } else if (arg === '--comment') {
      options.comment = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--os-user=')) {
      options.osUser = arg.slice('--os-user='.length)
    } else if (arg === '--os-user') {
      options.osUser = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--instance-id=')) {
      options.instanceId = arg.slice('--instance-id='.length)
    } else if (arg === '--instance-id') {
      options.instanceId = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unrecognized argument: ${arg}`)
    }
  }
  return options
}

async function main() {
  try {
    const cliOptions = parseArgs(process.argv.slice(2))
    const result = await publishEphemeralKey({
      stackName: cliOptions.stackName,
      region: cliOptions.region,
      comment: cliOptions.comment,
      osUser: cliOptions.osUser,
      instanceId: cliOptions.instanceId,
    })

    const output = JSON.stringify(result, null, cliOptions.pretty ? 2 : undefined)
    process.stdout.write(`${output}\n`)

    process.stderr.write(
      `Ephemeral key published for ${result.instanceId} in ${result.availabilityZone}. Expires at ${result.expiresAt}.\n`,
    )
    if (result.publicDnsName) {
      process.stderr.write(
        `Connect with: ssh -i /path/to/temp/key ${result.user}@${result.publicDnsName}\n`,
      )
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error during key publication'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}

await main()
