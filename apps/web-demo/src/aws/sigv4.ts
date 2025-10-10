const encoder = new TextEncoder()

interface SigV4Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

export interface SignUrlInput {
  readonly url: string
  readonly region: string
  readonly service: string
  readonly credentials: SigV4Credentials
  readonly method?: string
  readonly expiresIn?: number
  readonly now?: Date
}

function getSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'SubtleCrypto not available. Enable WebCrypto or run in a modern runtime.',
    )
  }
  return globalThis.crypto.subtle
}

function toUint8(input: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof input === 'string') {
    return encoder.encode(input)
  }
  if (input instanceof Uint8Array) {
    return input
  }
  return new Uint8Array(input)
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(view.byteLength)
  new Uint8Array(buffer).set(view)
  return buffer
}

async function hmacSha256(
  key: Uint8Array,
  data: string | Uint8Array,
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto()
  const cryptoKey = await subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const payload = toUint8(data)
  const signature = await subtle.sign(
    'HMAC',
    cryptoKey,
    toArrayBuffer(payload),
  )
  return new Uint8Array(signature)
}

async function sha256(data: string): Promise<string> {
  const subtle = getSubtleCrypto()
  const digest = await subtle.digest('SHA-256', encoder.encode(data))
  return toHex(new Uint8Array(digest))
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kSecret = encoder.encode(`AWS4${secretAccessKey}`)
  const kDate = await hmacSha256(kSecret, dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  return kSigning
}

function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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

function formatDate(now: Date): { amzDate: string; dateStamp: string } {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hours = String(now.getUTCHours()).padStart(2, '0')
  const minutes = String(now.getUTCMinutes()).padStart(2, '0')
  const seconds = String(now.getUTCSeconds()).padStart(2, '0')
  const dateStamp = `${year}${month}${day}`
  const amzDate = `${dateStamp}T${hours}${minutes}${seconds}Z`
  return { amzDate, dateStamp }
}

function normalizeMethod(method?: string): string {
  const normalized = method?.trim().toUpperCase()
  return normalized && normalized.length > 0 ? normalized : 'GET'
}

function validateExpires(expiresIn: number | undefined): number {
  const fallback = 60
  if (expiresIn == null) {
    return fallback
  }
  if (!Number.isFinite(expiresIn)) {
    throw new Error('expiresIn must be a finite number of seconds')
  }
  const rounded = Math.floor(expiresIn)
  if (rounded <= 0) {
    throw new Error('expiresIn must be greater than 0 seconds')
  }
  if (rounded > 604800) {
    throw new Error('expiresIn must be 604800 seconds (7 days) or fewer')
  }
  return rounded
}

export async function signUrlWithSigV4(
  input: SignUrlInput,
): Promise<string> {
  const url = new URL(input.url)
  const method = normalizeMethod(input.method)
  const expiresIn = validateExpires(input.expiresIn)

  if (!input.credentials.accessKeyId) {
    throw new Error('accessKeyId is required for SigV4 signing')
  }
  if (!input.credentials.secretAccessKey) {
    throw new Error('secretAccessKey is required for SigV4 signing')
  }
  if (!input.region) {
    throw new Error('region is required for SigV4 signing')
  }
  if (!input.service) {
    throw new Error('service is required for SigV4 signing')
  }

  const now = input.now ?? new Date()
  const { amzDate, dateStamp } = formatDate(now)

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const hostHeader = url.host.toLowerCase()

  const params: Array<[string, string]> = []
  url.searchParams.forEach((value, key) => {
    params.push([key, value])
  })
  params.push(['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'])
  params.push(['X-Amz-Credential', `${input.credentials.accessKeyId}/${credentialScope}`])
  params.push(['X-Amz-Date', amzDate])
  params.push(['X-Amz-Expires', String(expiresIn)])
  params.push(['X-Amz-SignedHeaders', 'host'])

  if (input.credentials.sessionToken) {
    params.push(['X-Amz-Security-Token', input.credentials.sessionToken])
  }

  const canonicalQuery = buildCanonicalQuery(params)
  const canonicalHeaders = `host:${hostHeader}\n`
  const signedHeaders = 'host'
  const canonicalPayload = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    canonicalPayload,
  ].join('\n')

  const hashedCanonicalRequest = await sha256(canonicalRequest)
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n')

  const signingKey = await deriveSigningKey(
    input.credentials.secretAccessKey,
    dateStamp,
    input.region,
    input.service,
  )

  const signature = await hmacSha256(signingKey, stringToSign)
  const signatureHex = toHex(signature)

  const finalParams =
    canonicalQuery.length > 0
      ? `${canonicalQuery}&X-Amz-Signature=${signatureHex}`
      : `X-Amz-Signature=${signatureHex}`
  url.search = finalParams

  return url.toString()
}

export type { SigV4Credentials }
