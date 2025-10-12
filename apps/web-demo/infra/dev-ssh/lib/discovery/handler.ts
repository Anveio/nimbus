import {
  DescribeInstanceConnectEndpointsCommand,
  DescribeInstancesCommand,
  DescribeVpcsCommand,
  EC2Client,
  type Filter,
} from '@aws-sdk/client-ec2'
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

interface DiscoveryRequestBody {
  readonly region?: string
}

interface DiscoveryResponse {
  readonly region: string
  readonly instances: Array<{
    readonly instanceId: string
    readonly state: string | undefined
    readonly availabilityZone: string | undefined
    readonly publicDnsName: string | undefined
    readonly publicIpAddress: string | undefined
    readonly privateIpAddress: string | undefined
    readonly name: string | undefined
    readonly vpcId: string | undefined
    readonly subnetId: string | undefined
    readonly tags: Record<string, string>
  }>
  readonly instanceConnectEndpoints: Array<{
    readonly endpointId: string
    readonly state: string | undefined
    readonly statusReason: string | undefined
    readonly createdAt: string | undefined
    readonly dnsName: string | undefined
    readonly vpcId: string | undefined
    readonly subnetId: string | undefined
    readonly securityGroupIds: readonly string[] | undefined
  }>
  readonly vpcs: Array<{
    readonly vpcId: string
    readonly cidrBlock: string | undefined
    readonly state: string | undefined
    readonly ownerId: string | undefined
    readonly tags: Record<string, string>
  }>
}

interface DiscoveryConfig {
  readonly bearerToken: string
  readonly defaultRegion: string
  readonly repositoryTagValue: string
}

const config: DiscoveryConfig = {
  bearerToken: requiredEnv('SIGNER_TOKEN'),
  defaultRegion:
    process.env.DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    '',
  repositoryTagValue: process.env.REPOSITORY_TAG_VALUE ?? 'mana-ssh-web',
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable ${key}`)
  }
  return value
}

function buildCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  }
}

function unauthorized(message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 401,
    headers: buildCorsHeaders(),
    body: JSON.stringify({
      error: 'unauthorized',
      message,
    }),
  }
}

function badRequest(message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 400,
    headers: buildCorsHeaders(),
    body: JSON.stringify({
      error: 'bad_request',
      message,
    }),
  }
}

function serverError(error: unknown): APIGatewayProxyStructuredResultV2 {
  const message =
    error instanceof Error ? error.message : 'Unknown server error'
  return {
    statusCode: 500,
    headers: buildCorsHeaders(),
    body: JSON.stringify({
      error: 'server_error',
      message,
    }),
  }
}

function parseRegion(event: {
  readonly body?: string | null
  readonly queryStringParameters?: Record<string, string | undefined>
}): string {
  const queryRegion = event.queryStringParameters?.region?.trim()
  if (queryRegion) {
    return queryRegion
  }
  if (event.body && event.body.trim().length > 0) {
    try {
      const parsed = JSON.parse(event.body) as DiscoveryRequestBody
      if (
        typeof parsed.region === 'string' &&
        parsed.region.trim().length > 0
      ) {
        return parsed.region.trim()
      }
    } catch (error) {
      throw new Error(
        `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!config.defaultRegion) {
    throw new Error(
      'Region not provided and DEFAULT_REGION environment variable is unset.',
    )
  }
  return config.defaultRegion
}

function normaliseTags(
  tags:
    | Array<{ Key?: string | undefined; Value?: string | undefined }>
    | undefined,
): Record<string, string> {
  if (!tags) {
    return {}
  }
  const record: Record<string, string> = {}
  for (const tag of tags) {
    if (!tag.Key) continue
    record[tag.Key] = tag.Value ?? ''
  }
  return record
}

function extractNameTag(tags: Record<string, string>): string | undefined {
  return tags.Name ?? tags.name ?? undefined
}

export async function handler(event: {
  readonly headers?: Record<string, string | undefined>
  readonly body?: string | null
  readonly queryStringParameters?: Record<string, string | undefined>
}): Promise<APIGatewayProxyStructuredResultV2> {
  if (
    event.headers?.authorization?.startsWith('Bearer ') !== true &&
    event.headers?.Authorization?.startsWith('Bearer ') !== true
  ) {
    return unauthorized('Missing bearer token.')
  }

  const providedToken =
    event.headers.authorization?.substring('Bearer '.length).trim() ??
    event.headers.Authorization?.substring('Bearer '.length).trim() ??
    ''

  if (providedToken !== config.bearerToken) {
    return unauthorized('Invalid bearer token.')
  }

  let region: string
  try {
    region = parseRegion(event)
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error))
  }

  const client = new EC2Client({ region })

  try {
    const [instances, endpoints] = await Promise.all([
      discoverInstances(client, config.repositoryTagValue),
      discoverInstanceConnectEndpoints(client, config.repositoryTagValue),
    ])

    const vpcIds = new Set<string>()

    for (const instance of instances) {
      if (instance.vpcId) {
        vpcIds.add(instance.vpcId)
      }
    }
    for (const endpoint of endpoints) {
      if (endpoint.vpcId) {
        vpcIds.add(endpoint.vpcId)
      }
    }

    const vpcs = vpcIds.size
      ? await describeVpcs(client, Array.from(vpcIds))
      : []

    const response: DiscoveryResponse = {
      region,
      instances,
      instanceConnectEndpoints: endpoints,
      vpcs,
    }

    return {
      statusCode: 200,
      headers: {
        ...buildCorsHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    }
  } catch (error) {
    return serverError(error)
  }
}

async function discoverInstances(
  client: EC2Client,
  repositoryTag: string,
): Promise<DiscoveryResponse['instances']> {
  const filters: Filter[] = [
    {
      Name: 'tag:mana:repository',
      Values: [repositoryTag],
    },
  ]
  const command = new DescribeInstancesCommand({
    Filters: filters,
  })
  const result = await client.send(command)
  const instances: DiscoveryResponse['instances'] = []
  for (const reservation of result.Reservations ?? []) {
    for (const instance of reservation.Instances ?? []) {
      const tags = normaliseTags(instance.Tags)
      instances.push({
        instanceId: instance.InstanceId ?? 'unknown',
        state: instance.State?.Name,
        availabilityZone: instance.Placement?.AvailabilityZone,
        publicDnsName: instance.PublicDnsName,
        publicIpAddress: instance.PublicIpAddress,
        privateIpAddress: instance.PrivateIpAddress,
        name: extractNameTag(tags),
        vpcId: instance.VpcId,
        subnetId: instance.SubnetId,
        tags,
      })
    }
  }
  return instances
}

async function discoverInstanceConnectEndpoints(
  client: EC2Client,
  repositoryTag: string,
): Promise<DiscoveryResponse['instanceConnectEndpoints']> {
  const filters: Filter[] = [
    {
      Name: 'tag:mana:repository',
      Values: [repositoryTag],
    },
  ]

  const command = new DescribeInstanceConnectEndpointsCommand({
    Filters: filters,
  })
  const result = await client.send(command)
  const endpoints: DiscoveryResponse['instanceConnectEndpoints'] = []
  for (const endpoint of result.InstanceConnectEndpoints ?? []) {
    endpoints.push({
      endpointId: endpoint.InstanceConnectEndpointId ?? 'unknown',
      state: endpoint.State,
      statusReason: endpoint.StateMessage,
      createdAt: endpoint.CreatedAt?.toISOString(),
      dnsName: endpoint.DnsName,
      vpcId: endpoint.VpcId,
      subnetId: endpoint.SubnetId,
      securityGroupIds: endpoint.SecurityGroupIds,
    })
  }
  return endpoints
}

async function describeVpcs(
  client: EC2Client,
  vpcIds: string[],
): Promise<DiscoveryResponse['vpcs']> {
  const command = new DescribeVpcsCommand({
    VpcIds: vpcIds,
  })
  const result = await client.send(command)
  const vpcs: DiscoveryResponse['vpcs'] = []
  for (const vpc of result.Vpcs ?? []) {
    const tags = normaliseTags(vpc.Tags)
    vpcs.push({
      vpcId: vpc.VpcId ?? 'unknown',
      cidrBlock: vpc.CidrBlock,
      state: vpc.State,
      ownerId: vpc.OwnerId,
      tags,
    })
  }
  return vpcs
}
