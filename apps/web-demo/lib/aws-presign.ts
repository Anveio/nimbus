export type AwsHttpMethod = 'GET' | 'POST'

export type AwsPresignedPayload = string | ArrayBuffer | Uint8Array

export interface CreateAwsPresignedUrlParams {
  readonly method: AwsHttpMethod
  readonly host: string
  readonly path: string
  readonly service: string
  readonly payload?: AwsPresignedPayload
  readonly key: string
  readonly secret: string
  readonly sessionToken?: string
  readonly protocol: 'wss' | 'https'
  readonly timestamp: number
  readonly region: string
  readonly expires: number
  readonly query: Readonly<Record<string, string | number | boolean>>
  readonly headers: Readonly<Record<string, string>>
}

const cryptoApi: Crypto = (() => {
  const instance = globalThis.crypto
  if (!instance?.subtle) {
    throw new Error('Web Crypto API is required for AWS presigning.')
  }
  return instance
})()

const textEncoder = new TextEncoder()

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

function createCanonicalQuerystring(params: Record<string, string>): string {
  const entries = Object.entries(params).sort(compareQueryEntries)
  return entries
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
  host: string,
): { canonicalHeaders: string; signedHeaders: string } {
  const entries: Array<[string, string]> = []
  for (const [name, value] of Object.entries(headers)) {
    const trimmedName = name.trim().toLowerCase()
    if (!trimmedName) {
      continue
    }
    const normalizedValue = value.trim().replace(/\s+/g, ' ')
    entries.push([trimmedName, normalizedValue])
  }
  if (!entries.some(([name]) => name === 'host')) {
    entries.push(['host', host])
  }
  entries.sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
  const canonicalHeaders = `${entries
    .map(([name, value]) => `${name}:${value}`)
    .join('\n')}\n`
  const signedHeaders = entries.map(([name]) => name).join(';')
  return { canonicalHeaders, signedHeaders }
}

function formatTimestamp(timestamp: number): {
  readonly amzDate: string
  readonly dateStamp: string
} {
  if (!Number.isFinite(timestamp)) {
    throw new Error('Timestamp must be a finite number of milliseconds.')
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Timestamp must produce a valid Date.')
  }
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

function toArrayBuffer(input: string | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (typeof input === 'string') {
    return textEncoder.encode(input).buffer
  }
  if (input instanceof ArrayBuffer) {
    return input
  }
  const view = input as Uint8Array
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy.buffer
}

async function hmac(
  key: string | ArrayBuffer | Uint8Array,
  value: string,
): Promise<ArrayBuffer> {
  const rawKey = toArrayBuffer(key)
  const cryptoKey = await cryptoApi.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return cryptoApi.subtle.sign('HMAC', cryptoKey, textEncoder.encode(value))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await cryptoApi.subtle.digest(
    'SHA-256',
    textEncoder.encode(value),
  )
  return bufferToHex(digest)
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(`AWS4${secret}`, dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function ensureLeadingSlash(path: string): string {
  if (path.startsWith('/')) {
    return path
  }
  return `/${path}`
}

function isPayloadEmpty(payload: AwsPresignedPayload): boolean {
  if (typeof payload === 'string') {
    return payload.length === 0
  }
  if (payload instanceof Uint8Array) {
    return payload.byteLength === 0
  }
  return payload.byteLength === 0
}

function payloadToUint8Array(payload: AwsPresignedPayload): Uint8Array {
  if (typeof payload === 'string') {
    return textEncoder.encode(payload)
  }
  if (payload instanceof Uint8Array) {
    return payload.slice()
  }
  return new Uint8Array(payload).slice()
}

async function resolvePayloadHash(
  payload: AwsPresignedPayload | undefined,
): Promise<string> {
  if (payload === undefined || isPayloadEmpty(payload)) {
    return 'UNSIGNED-PAYLOAD'
  }
  const bytes = payloadToUint8Array(payload)
  const digest = await cryptoApi.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return bufferToHex(digest)
}

export async function createAwsPresignedUrl(
  params: CreateAwsPresignedUrlParams,
): Promise<string> {
  const method = params.method.toUpperCase() as AwsHttpMethod
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`Unsupported HTTP method: ${params.method}`)
  }

  const normalizedHost = params.host.trim()
  if (!normalizedHost) {
    throw new Error('Host is required for presigning.')
  }

  const normalizedPath = ensureLeadingSlash(params.path.trim())
  const { amzDate, dateStamp } = formatTimestamp(params.timestamp)
  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`

  const { canonicalHeaders, signedHeaders } = normalizeHeaders(
    params.headers,
    normalizedHost,
  )

  const queryParams: Record<string, string> = {}
  for (const [key, value] of Object.entries(params.query)) {
    queryParams[key] = String(value)
  }
  queryParams['X-Amz-Algorithm'] = 'AWS4-HMAC-SHA256'
  queryParams['X-Amz-Credential'] = `${params.key}/${credentialScope}`
  queryParams['X-Amz-Date'] = amzDate
  queryParams['X-Amz-Expires'] = String(params.expires)
  queryParams['X-Amz-SignedHeaders'] = signedHeaders
  if (params.sessionToken) {
    queryParams['X-Amz-Security-Token'] = params.sessionToken
  }

  const canonicalQuerystring = createCanonicalQuerystring(queryParams)
  const payloadHash = await resolvePayloadHash(params.payload)
  const canonicalRequest = [
    method,
    canonicalUri(normalizedPath),
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await deriveSigningKey(
    params.secret,
    dateStamp,
    params.region,
    params.service,
  )
  const signature = bufferToHex(await hmac(signingKey, stringToSign))

  const url = new URL(`${params.protocol}://${normalizedHost}`)
  url.pathname = normalizedPath
  url.search = `${canonicalQuerystring}&X-Amz-Signature=${signature}`
  return url.toString()
}

export const __testing = {
  encodeRfc3986,
  canonicalUri,
  createCanonicalQuerystring,
  normalizeHeaders,
  formatTimestamp,
}
