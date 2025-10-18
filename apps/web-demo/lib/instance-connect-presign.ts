import { createAwsPresignedUrl } from './aws-presign'

interface SignerConfig {
  readonly defaultEndpoint: string
  readonly defaultRegion: string
  readonly defaultService: string
  readonly maxExpires: number
  readonly defaultExpires: number
}

interface SigningCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

export interface InstanceConnectPresignParams {
  readonly instanceId: string
  readonly region?: string
  readonly endpoint?: string
  readonly service?: string
  readonly expiresIn?: number
  readonly addressFamily?: 'ipv4' | 'ipv6'
  readonly port?: number
  readonly timestamp?: number
}

export interface InstanceConnectPresignResult {
  readonly url: string
  readonly expiresIn: number
  readonly region: string
  readonly service: string
}

const signerConfig: SignerConfig = {
  defaultEndpoint:
    process.env.NIMBUS_SIGNER_DEFAULT_ENDPOINT ??
    process.env.SIGNER_DEFAULT_ENDPOINT ??
    'wss://prod.us-west-2.oneclickv2-proxy.ec2.aws.dev/proxy/instance-connect',
  defaultRegion:
    process.env.NIMBUS_SIGNER_DEFAULT_REGION ??
    process.env.SIGNER_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    '',
  defaultService:
    process.env.NIMBUS_SIGNER_DEFAULT_SERVICE ??
    process.env.SIGNER_DEFAULT_SERVICE ??
    'ec2-instance-connect',
  maxExpires:
    Number.parseInt(
      process.env.NIMBUS_SIGNER_MAX_EXPIRES ??
        process.env.SIGNER_MAX_EXPIRES ??
        '',
      10,
    ) || 300,
  defaultExpires:
    Number.parseInt(
      process.env.NIMBUS_SIGNER_DEFAULT_EXPIRES ??
        process.env.SIGNER_DEFAULT_EXPIRES ??
        '',
      10,
    ) || 60,
}

const signingCredentials: SigningCredentials | null =
  typeof process.env.AWS_ACCESS_KEY_ID === 'string' &&
  typeof process.env.AWS_SECRET_ACCESS_KEY === 'string'
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
    : null

function ensureCredentials(): SigningCredentials {
  if (!signingCredentials) {
    throw new Error(
      'AWS credentials are not available. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
    )
  }
  return signingCredentials
}

function sanitizeEndpoint(endpoint: string | undefined): URL {
  const candidate = endpoint?.trim().length
    ? endpoint.trim()
    : signerConfig.defaultEndpoint
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
      throw new Error('Endpoint must use https:// or wss://')
    }
    return url
  } catch (error) {
    throw new Error(
      `Endpoint must be a valid URL: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function sanitizeRegion(region: string | undefined): string {
  const resolved = region?.trim().length ? region.trim() : signerConfig.defaultRegion
  if (!resolved) {
    throw new Error('Unable to determine AWS region for signing.')
  }
  return resolved
}

function sanitizeService(service: string | undefined): string {
  const resolved = service?.trim().length
    ? service.trim()
    : signerConfig.defaultService
  if (!resolved) {
    throw new Error('Service identifier is required for signing.')
  }
  return resolved
}

function sanitizeExpires(expires: number | undefined): number {
  if (expires == null) {
    return signerConfig.defaultExpires
  }
  if (!Number.isFinite(expires)) {
    throw new Error('expiresIn must be a finite number of seconds.')
  }
  const rounded = Math.floor(expires)
  if (rounded <= 0) {
    throw new Error('expiresIn must be greater than 0.')
  }
  if (rounded > signerConfig.maxExpires) {
    throw new Error(
      `expiresIn must be less than or equal to ${signerConfig.maxExpires} seconds.`,
    )
  }
  return rounded
}

function sanitizePort(port: number | undefined): number {
  if (port == null) {
    return 22
  }
  if (!Number.isFinite(port)) {
    throw new Error('port must be a finite number.')
  }
  const rounded = Math.floor(port)
  if (rounded <= 0 || rounded > 65535) {
    throw new Error('port must be between 1 and 65535.')
  }
  return rounded
}

function sanitizeAddressFamily(
  family: 'ipv4' | 'ipv6' | undefined,
): 'ipv4' | 'ipv6' {
  if (family === 'ipv4' || family === 'ipv6') {
    return family
  }
  return 'ipv4'
}

function sanitizeTimestamp(timestamp: number | undefined): number {
  if (timestamp == null) {
    return Date.now()
  }
  if (!Number.isFinite(timestamp)) {
    throw new Error('timestamp must be a finite number of milliseconds.')
  }
  return timestamp
}

function normalizeProtocol(protocol: string): 'https' | 'wss' {
  const trimmed = protocol.replace(/:$/, '')
  if (trimmed === 'https' || trimmed === 'wss') {
    return trimmed
  }
  throw new Error('Unsupported endpoint protocol.')
}

export async function createInstanceConnectPresignedUrl(
  params: InstanceConnectPresignParams,
): Promise<InstanceConnectPresignResult> {
  const endpoint = sanitizeEndpoint(params.endpoint)
  const region = sanitizeRegion(params.region)
  const service = sanitizeService(params.service)
  const expiresIn = sanitizeExpires(params.expiresIn)
  const port = sanitizePort(params.port)
  const addressFamily = sanitizeAddressFamily(params.addressFamily)
  const timestamp = sanitizeTimestamp(params.timestamp)

  if (!params.instanceId?.trim()) {
    throw new Error('instanceId is required to sign the URL.')
  }

  const credentials = ensureCredentials()
  const protocol = normalizeProtocol(endpoint.protocol)
  const host = endpoint.host
  const pathname = endpoint.pathname.length > 0 ? endpoint.pathname : '/'

  const query = {
    instanceId: params.instanceId,
    port: port.toString(10),
    addressFamily,
  } as const

  const url = await createAwsPresignedUrl({
    method: 'GET',
    host,
    path: pathname,
    service,
    payload: '',
    key: credentials.accessKeyId,
    secret: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    protocol,
    timestamp,
    region,
    expires: expiresIn,
    query,
    headers: {
      Host: host,
    },
  })

  return {
    url,
    expiresIn,
    region,
    service,
  }
}
