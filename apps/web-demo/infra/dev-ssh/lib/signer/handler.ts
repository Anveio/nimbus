import { createHash, createHmac } from 'node:crypto'
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

interface SignRequestPayload {
  endpoint?: string
  region?: string
  service?: string
  expiresIn?: number
}

interface SignerConfig {
  readonly defaultEndpoint: string
  readonly defaultRegion: string
  readonly defaultService: string
  readonly maxExpires: number
  readonly defaultExpires: number
  readonly bearerToken: string
}

interface SigningCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

const config: SignerConfig = {
  defaultEndpoint: requiredEnv('DEFAULT_ENDPOINT'),
  defaultRegion:
    process.env.DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    '',
  defaultService: process.env.DEFAULT_SERVICE ?? 'ec2-instance-connect',
  maxExpires: parseIntEnv('MAX_EXPIRES', 300),
  defaultExpires: parseIntEnv('DEFAULT_EXPIRES', 60),
  bearerToken: requiredEnv('SIGNER_TOKEN'),
}

const credentials: SigningCredentials = {
  accessKeyId: requiredEnv('AWS_ACCESS_KEY_ID'),
  secretAccessKey: requiredEnv('AWS_SECRET_ACCESS_KEY'),
  sessionToken: process.env.AWS_SESSION_TOKEN,
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function unauthorized(message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 401,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'unauthorized', message }),
  }
}

function badRequest(message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'bad_request', message }),
  }
}

function serverError(error: unknown): APIGatewayProxyStructuredResultV2 {
  const message =
    error instanceof Error ? error.message : 'Unknown server error'
  return {
    statusCode: 500,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'server_error', message }),
  }
}

function parseRequest(
  rawBody: string | undefined | null,
): SignRequestPayload {
  if (!rawBody || rawBody.trim().length === 0) {
    return {}
  }
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    const payload: SignRequestPayload = {}
    if (typeof parsed.endpoint === 'string') {
      payload.endpoint = parsed.endpoint
    }
    if (typeof parsed.region === 'string') {
      payload.region = parsed.region
    }
    if (typeof parsed.service === 'string') {
      payload.service = parsed.service
    }
    if (typeof parsed.expiresIn === 'number') {
      payload.expiresIn = parsed.expiresIn
    }
    return payload
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sanitizeEndpoint(endpoint: string | undefined): string {
  const candidate = endpoint?.trim().length ? endpoint.trim() : config.defaultEndpoint
  let url: URL
  try {
    url = new URL(candidate)
  } catch (error) {
    throw new Error(`Endpoint must be a valid URL: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
    throw new Error('Endpoint must use https:// or wss://')
  }
  return url.toString()
}

function sanitizeRegion(region: string | undefined): string {
  const resolved = region?.trim().length ? region.trim() : config.defaultRegion
  if (!resolved) {
    throw new Error('Unable to determine AWS region for signing')
  }
  return resolved
}

function sanitizeService(service: string | undefined): string {
  const resolved = service?.trim().length ? service.trim() : config.defaultService
  if (!resolved) {
    throw new Error('Service identifier is required for signing')
  }
  return resolved
}

function sanitizeExpires(expires: number | undefined): number {
  const fallback = config.defaultExpires
  if (expires == null) {
    return fallback
  }
  if (!Number.isFinite(expires)) {
    throw new Error('expiresIn must be a finite number of seconds')
  }
  const rounded = Math.floor(expires)
  if (rounded <= 0) {
    throw new Error('expiresIn must be greater than 0 seconds')
  }
  if (rounded > config.maxExpires) {
    throw new Error(
      `expiresIn must be less than or equal to ${config.maxExpires} seconds`,
    )
  }
  return rounded
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%[0-9a-f]{2}/g, (match) => match.toUpperCase())
}

function canonicalUri(pathname: string): string {
  if (pathname.length === 0) {
    return '/'
  }
  const segments = pathname.split('/').map((segment) => encodeRfc3986(segment))
  if (segments.length === 1 && segments[0] === '') {
    return '/'
  }
  return segments.join('/')
}

function compareQueryEntries(
  [keyA, valueA]: [string, string],
  [keyB, valueB]: [string, string],
): number {
  if (keyA < keyB) return -1
  if (keyA > keyB) return 1
  if (valueA < valueB) return -1
  if (valueA > valueB) return 1
  return 0
}

function buildCanonicalQuery(params: Array<[string, string]>): string {
  const encoded = params.map(([key, value]) => [
    encodeRfc3986(key),
    encodeRfc3986(value),
  ]) as Array<[string, string]>
  encoded.sort(compareQueryEntries)
  return encoded.map(([key, value]) => `${key}=${value}`).join('&')
}

function deriveSigningKey(
  key: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(service).digest()
  return createHmac('sha256', kService).update('aws4_request').digest()
}

function signUrl(
  input: {
    endpoint: string
    region: string
    service: string
    expiresIn: number
    now: Date
  },
  creds: SigningCredentials,
): { signedUrl: string; expiresAt: string } {
  const url = new URL(input.endpoint)
  const method = 'GET'
  const now = input.now
  const dateStamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('')
  const amzDate = `${dateStamp}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`

  const params: Array<[string, string]> = []
  url.searchParams.forEach((value, key) => {
    params.push([key, value])
  })
  params.push(['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'])
  params.push(['X-Amz-Credential', `${creds.accessKeyId}/${credentialScope}`])
  params.push(['X-Amz-Date', amzDate])
  params.push(['X-Amz-Expires', String(input.expiresIn)])
  params.push(['X-Amz-SignedHeaders', 'host'])
  if (creds.sessionToken) {
    params.push(['X-Amz-Security-Token', creds.sessionToken])
  }

  const canonicalQuery = buildCanonicalQuery(params)
  const canonicalHeaders = `host:${url.host.toLowerCase()}\n`
  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const hashedCanonicalRequest = createHash('sha256')
    .update(canonicalRequest, 'utf8')
    .digest('hex')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n')

  const signingKey = deriveSigningKey(
    creds.secretAccessKey,
    dateStamp,
    input.region,
    input.service,
  )

  const signature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex')

  const finalQuery =
    canonicalQuery.length > 0
      ? `${canonicalQuery}&X-Amz-Signature=${signature}`
      : `X-Amz-Signature=${signature}`
  url.search = finalQuery

  const expiresAt = new Date(
    now.getTime() + input.expiresIn * 1000,
  ).toISOString()

  return { signedUrl: url.toString(), expiresAt }
}

export async function handler(
  event: {
    readonly headers?: Record<string, string | undefined>
    readonly body?: string | null
  },
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const authHeader =
      event.headers?.authorization ?? event.headers?.Authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized('Missing bearer token')
    }
    const providedToken = authHeader.substring('Bearer '.length).trim()
    if (providedToken !== config.bearerToken) {
      return unauthorized('Invalid bearer token')
    }

    const payload = parseRequest(event.body)

    const endpoint = sanitizeEndpoint(payload.endpoint)
    const region = sanitizeRegion(payload.region)
    const service = sanitizeService(payload.service)
    const expiresIn = sanitizeExpires(payload.expiresIn)

    const result = signUrl(
      {
        endpoint,
        region,
        service,
        expiresIn,
        now: new Date(),
      },
      credentials,
    )

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        signedUrl: result.signedUrl,
        expiresAt: result.expiresAt,
        defaults: {
          endpoint,
          region,
          service,
          maxExpires: config.maxExpires,
        },
      }),
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Endpoint must')) {
      return badRequest(error.message)
    }
    if (error instanceof Error && error.message.includes('expiresIn')) {
      return badRequest(error.message)
    }
    if (error instanceof Error && error.message.startsWith('Invalid JSON')) {
      return badRequest(error.message)
    }
    if (
      error instanceof Error &&
      error.message.includes('Unable to determine AWS region')
    ) {
      return badRequest(error.message)
    }
    return serverError(error)
  }
}
