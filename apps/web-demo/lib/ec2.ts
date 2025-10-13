import {
  DescribeInstancesCommand,
  EC2Client,
  paginateDescribeInstances,
  type Instance,
} from '@aws-sdk/client-ec2'

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

function getConfiguredRegions(): readonly string[] {
  const configured =
    process.env.NIMBUS_WEB_DEMO_REGIONS ??
    process.env.WEB_DEMO_REGIONS ?? // legacy
    ''
  const regions = configured
    .split(',')
    .map((region) => region.trim())
    .filter((region) => region.length > 0)

  if (regions.length > 0) {
    return regions
  }

  const fallback =
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.CDK_DEFAULT_REGION

  return fallback ? [fallback] : []
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
    name: tags.Name ?? tags['Name'],
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

export async function listEc2Instances(): Promise<ListInstancesResult> {
  const regions = getConfiguredRegions()
  if (regions.length === 0) {
    return {
      kind: 'error',
      message:
        'No AWS region configured. Set NIMBUS_WEB_DEMO_REGIONS or AWS_REGION in the deployment environment.',
    }
  }

  try {
    const summaries: Ec2InstanceSummary[] = []
    for (const region of regions) {
      const instances = await collectRegionInstances(region)
      summaries.push(
        ...instances
          .filter((instance) => instance.InstanceId)
          .map((instance) => toSummary(instance, region)),
      )
    }
    summaries.sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    return { kind: 'success', instances: summaries }
  } catch (error) {
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
): Promise<FetchInstanceResult> {
  const regions = getConfiguredRegions()
  if (regions.length === 0) {
    return {
      kind: 'error',
      message:
        'No AWS region configured. Set NIMBUS_WEB_DEMO_REGIONS or AWS_REGION in the deployment environment.',
    }
  }
  const trimmedId = instanceId.trim()
  if (!trimmedId) {
    return { kind: 'not-found' }
  }
  try {
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
