import {
  DescribeInstancesCommand,
  EC2Client,
  type Instance,
  paginateDescribeInstances,
} from '@aws-sdk/client-ec2'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'

export interface Ec2InstanceSummary {
  readonly instanceId: string
  readonly region: string
  readonly name?: string
  readonly state?: string
  readonly instanceType?: string
  readonly availabilityZone?: string
  readonly publicDnsName?: string
  readonly publicIpAddress?: string
  readonly privateIpAddress?: string
  readonly launchTime?: string
  readonly tags: Record<string, string>
}

export type ListInstancesResult =
  | {
      readonly kind: 'success'
      readonly instances: readonly Ec2InstanceSummary[]
    }
  | {
      readonly kind: 'auth-error'
      readonly message: string
    }
  | {
      readonly kind: 'error'
      readonly message: string
    }

export type FetchInstanceResult =
  | {
      readonly kind: 'success'
      readonly instance: Ec2InstanceSummary
    }
  | {
      readonly kind: 'not-found'
    }
  | {
      readonly kind: 'auth-error'
      readonly message: string
    }
  | {
      readonly kind: 'error'
      readonly message: string
    }

export function getConfiguredRegions(
  regionParam?: string | null,
): readonly string[] {
  const trimmed = regionParam?.trim()
  if (trimmed && trimmed.length > 0) {
    return [trimmed]
  }
  return ['us-west-2']
}

function normalizeTags(instance: Instance): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const tag of instance.Tags ?? []) {
    if (tag?.Key) {
      tags[tag.Key] = tag.Value ?? ''
    }
  }
  return tags
}

function toSummary(instance: Instance, region: string): Ec2InstanceSummary {
  const tags = normalizeTags(instance)
  return {
    instanceId: instance.InstanceId ?? 'unknown',
    region,
    name: tags.Name ?? tags.Name,
    state: instance.State?.Name,
    instanceType: instance.InstanceType,
    availabilityZone: instance.Placement?.AvailabilityZone,
    publicDnsName: instance.PublicDnsName,
    publicIpAddress: instance.PublicIpAddress,
    privateIpAddress: instance.PrivateIpAddress,
    launchTime: instance.LaunchTime?.toISOString(),
    tags,
  }
}

const AUTH_ERROR_CODES = new Set([
  'CredentialsProviderError',
  'InvalidAccessKeyId',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'RequestExpired',
  'ExpiredToken',
  'AccessDeniedException',
  'AuthFailure',
])

function isAuthError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const name = Reflect.get(error, 'name')
    if (typeof name === 'string' && AUTH_ERROR_CODES.has(name)) {
      return true
    }
    const code = Reflect.get(error, '$metadata')?.httpStatusCode
    if (code === 401 || code === 403) {
      return true
    }
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string') {
      const lower = message.toLowerCase()
      if (
        lower.includes('credentials') ||
        lower.includes('access denied') ||
        lower.includes('not authorized') ||
        lower.includes('authfailure')
      ) {
        return true
      }
    }
  }
  return false
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

let identityChecked = false

async function ensureAwsIdentity(region: string): Promise<void> {
  if (identityChecked) {
    return
  }
  const sts = new STSClient({ region })
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}))
    console.info('[aws:identity] Using credentials', {
      account: identity.Account,
      userId: identity.UserId,
    })
    identityChecked = true
  } catch (error) {
    console.error('[aws:identity] Failed to resolve identity', {
      error: describeError(error),
    })
    throw error
  }
}

async function collectRegionInstances(
  region: string,
  instanceIds?: readonly string[],
): Promise<Instance[]> {
  const client = new EC2Client({ region })

  if (instanceIds && instanceIds.length > 0) {
    const response = await client.send(
      new DescribeInstancesCommand({
        InstanceIds: instanceIds.map((id) => id.trim()).filter(Boolean),
      }),
    )
    const matches: Instance[] = []
    for (const reservation of response.Reservations ?? []) {
      matches.push(...(reservation.Instances ?? []))
    }
    return matches
  }

  const paginator = paginateDescribeInstances({ client }, {})
  const instances: Instance[] = []
  for await (const page of paginator) {
    for (const reservation of page.Reservations ?? []) {
      instances.push(...(reservation.Instances ?? []))
    }
  }
  return instances
}

export async function listEc2Instances(
  regionOverride?: string | null,
): Promise<ListInstancesResult> {
  const regions = getConfiguredRegions(regionOverride)

  try {
    await ensureAwsIdentity(regions[0] ?? 'us-west-2')
    const summaries: Ec2InstanceSummary[] = []
    for (const region of regions) {
      const instances = await collectRegionInstances(region)
      console.debug('[ec2:list] Retrieved instances', {
        region,
        count: instances.length,
      })
      summaries.push(
        ...instances
          .filter((instance) => instance.InstanceId)
          .map((instance) => toSummary(instance, region)),
      )
    }
    summaries.sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    console.info('[ec2:list] Discovery complete', {
      totalInstances: summaries.length,
    })
    return { kind: 'success', instances: summaries }
  } catch (error) {
    console.error('[ec2:list] Discovery failed', {
      error: describeError(error),
    })
    if (isAuthError(error)) {
      return {
        kind: 'auth-error',
        message:
          'Unable to access EC2 APIs with the provided AWS credentials. Verify AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or the instance profile.',
      }
    }
    return {
      kind: 'error',
      message: describeError(error),
    }
  }
}

export async function getEc2InstanceById(
  instanceId: string,
  regionOverride?: string | null,
): Promise<FetchInstanceResult> {
  const regions = getConfiguredRegions(regionOverride)
  const trimmedId = instanceId.trim()
  if (!trimmedId) {
    return { kind: 'not-found' }
  }
  try {
    await ensureAwsIdentity(regions[0] ?? 'us-west-2')
    for (const region of regions) {
      const matches = await collectRegionInstances(region, [trimmedId])
      const match = matches.find(
        (instance) => instance.InstanceId === trimmedId,
      )
      if (match) {
        return { kind: 'success', instance: toSummary(match, region) }
      }
    }
    return { kind: 'not-found' }
  } catch (error) {
    if (isAuthError(error)) {
      return {
        kind: 'auth-error',
        message:
          'Unable to access EC2 APIs with the provided AWS credentials. Verify AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or the instance profile.',
      }
    }
    return { kind: 'error', message: describeError(error) }
  }
}
