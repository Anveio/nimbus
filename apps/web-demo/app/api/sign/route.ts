import { createHash, createHmac } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'

type SignRequestPayload = {
  readonly endpoint?: string
  readonly region?: string
  readonly service?: string
  readonly expiresIn?: number
}

interface SignerConfig {
  readonly defaultEndpoint: string
  readonly defaultRegion: string
  readonly defaultService: string
  readonly maxExpires: number
  readonly defaultExpires: number
  readonly bearerToken?: string
}

interface SigningCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

const config: SignerConfig = {
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
  bearerToken:
    process.env.NIMBUS_SIGNER_TOKEN ?? process.env.SIGNER_TOKEN ?? undefined,
}

const credentials: SigningCredentials | null =
  typeof process.env.AWS_ACCESS_KEY_ID === 'string' &&
  typeof process.env.AWS_SECRET_ACCESS_KEY === 'string'
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
    : null

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

export const dynamic = 'force-dynamic'

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

function sanitizeEndpoint(endpoint: string | undefined): URL {
  const candidate = endpoint?.trim().length
    ? endpoint.trim()
    : config.defaultEndpoint
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
  const resolved = region?.trim().length ? region.trim() : config.defaultRegion
  if (!resolved) {
    throw new Error('Unable to determine AWS region for signing.')
  }
  return resolved
}

function sanitizeService(service: string | undefined): string {
  const resolved = service?.trim().length
    ? service.trim()
    : config.defaultService
  if (!resolved) {
    throw new Error('Service identifier is required for signing.')
  }
  return resolved
}

function sanitizeExpires(expires: number | undefined): number {
  if (expires == null) {
    return config.defaultExpires
  }
  if (!Number.isFinite(expires)) {
    throw new Error('expiresIn must be a finite number of seconds.')
  }
  const rounded = Math.floor(expires)
  if (rounded <= 0) {
    throw new Error('expiresIn must be greater than 0.')
  }
  if (rounded > config.maxExpires) {
    throw new Error(
      `expiresIn must be less than or equal to ${config.maxExpires} seconds.`,
    )
  }
  return rounded
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value)
    .replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%[0-9a-f]{2}/g, (match) => match.toUpperCase())
}

function canonicalUri(pathname: string): string {
  if (pathname === '' || pathname === '/') {
    return '/'
  }
  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/')
}

function compareQueryEntries(
  [keyA, valueA]: [string, string],
  [keyB, valueB]: [string, string],
): number {
  if (keyA === keyB) {
    return valueA.localeCompare(valueB)
  }
  return keyA.localeCompare(keyB)
}

function createCanonicalQuerystring(
  params: Record<string, string>,
): string {
  const entries = Object.entries(params).sort(compareQueryEntries)
  return entries
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function buildSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function createStringToSign(
  amzDate: string,
  credentialScope: string,
  canonicalRequest: string,
): string {
  return [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join('\n')
}

function formatDate(date: Date): { amzDate: string; dateStamp: string } {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const HH = String(date.getUTCHours()).padStart(2, '0')
  const MM = String(date.getUTCMinutes()).padStart(2, '0')
  const SS = String(date.getUTCSeconds()).padStart(2, '0')

  return {
    amzDate: `${yyyy}${mm}${dd}T${HH}${MM}${SS}Z`,
    dateStamp: `${yyyy}${mm}${dd}`,
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (config.bearerToken) {
    const header =
      req.headers.get('authorization') ?? req.headers.get('Authorization')
    const token =
      header?.startsWith('Bearer ') === true
        ? header.slice('Bearer '.length).trim()
        : null
    if (!token || token !== config.bearerToken) {
      return jsonResponse(401, {
        error: 'unauthorized',
        message: 'Invalid or missing bearer token.',
      })
    }
  }

  if (!credentials) {
    return jsonResponse(500, {
      error: 'server_error',
      message:
        'AWS credentials are not available to the signer. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
    })
  }

  let payload: SignRequestPayload
  try {
    payload = (await req.json()) as SignRequestPayload
  } catch (error) {
    return jsonResponse(400, {
      error: 'bad_request',
      message: `Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  try {
    const endpointUrl = sanitizeEndpoint(payload.endpoint)
    const region = sanitizeRegion(payload.region)
    const service = sanitizeService(payload.service)
    const expiresIn = sanitizeExpires(payload.expiresIn)

    const { amzDate, dateStamp } = formatDate(new Date())
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

    const host = endpointUrl.host
    const canonicalHeaders = `host:${host}\n`
    const signedHeaders = 'host'

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${credentials.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': signedHeaders,
    }

    if (credentials.sessionToken) {
      queryParams['X-Amz-Security-Token'] = credentials.sessionToken
    }

    const canonicalQuerystring = createCanonicalQuerystring(queryParams)
    const canonicalRequest = [
      'GET',
      canonicalUri(endpointUrl.pathname),
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const stringToSign = createStringToSign(
      amzDate,
      credentialScope,
      canonicalRequest,
    )
    const signingKey = buildSigningKey(
      credentials.secretAccessKey,
      dateStamp,
      region,
      service,
    )
    const signature = hmac(signingKey, stringToSign).toString('hex')

    const signedUrl = `${endpointUrl.toString()}?${
      canonicalQuerystring
    }&X-Amz-Signature=${signature}`

    return jsonResponse(200, {
      url: signedUrl,
      expiresIn,
      region,
      service,
    })
  } catch (error) {
    return jsonResponse(400, {
      error: 'bad_request',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
