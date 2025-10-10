import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { signUrlWithSigV4 } from './sigv4'

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

function canonicalizeQuery(params: URLSearchParams): string {
  const entries: Array<[string, string]> = []
  params.forEach((value, key) => {
    if (key === 'X-Amz-Signature') {
      return
    }
    entries.push([
      encodeRfc3986(key),
      encodeRfc3986(value),
    ])
  })
  entries.sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA < keyB) return -1
    if (keyA > keyB) return 1
    if (valueA < valueB) return -1
    if (valueA > valueB) return 1
    return 0
  })
  return entries.map(([key, value]) => `${key}=${value}`).join('&')
}

function deriveSignature(
  scope: { dateStamp: string; region: string; service: string },
  secret: string,
  stringToSign: string,
): string {
  const kDate = createHmac('sha256', `AWS4${secret}`)
    .update(scope.dateStamp)
    .digest()
  const kRegion = createHmac('sha256', kDate).update(scope.region).digest()
  const kService = createHmac('sha256', kRegion).update(scope.service).digest()
  const kSigning = createHmac('sha256', kService)
    .update('aws4_request')
    .digest()
  return createHmac('sha256', kSigning).update(stringToSign).digest('hex')
}

describe('signUrlWithSigV4', () => {
  it('matches the signature derived via Node crypto for a query presign', async () => {
    const now = new Date('2024-01-05T12:34:56Z')
    const baseUrl =
      'wss://example.amazonaws.com/iam/?Action=ListUsers&Version=2010-05-08'

    const signedUrl = await signUrlWithSigV4({
      url: baseUrl,
      region: 'us-east-1',
      service: 'iam',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      expiresIn: 300,
      now,
    })

    const parsed = new URL(signedUrl)
    expect(parsed.protocol).toBe('wss:')

    const signature = parsed.searchParams.get('X-Amz-Signature')
    expect(signature).toBeTruthy()

    const canonicalQuery = canonicalizeQuery(parsed.searchParams)
    const canonicalRequest = [
      'GET',
      canonicalUri(parsed.pathname),
      canonicalQuery,
      `host:${parsed.host.toLowerCase()}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const hashedCanonicalRequest = createHash('sha256')
      .update(canonicalRequest, 'utf8')
      .digest('hex')

    const amzDate = parsed.searchParams.get('X-Amz-Date')
    expect(amzDate).toBe('20240105T123456Z')

    const credential = parsed.searchParams.get('X-Amz-Credential')
    expect(credential).toBe(
      'AKIDEXAMPLE/20240105/us-east-1/iam/aws4_request',
    )

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      '20240105/us-east-1/iam/aws4_request',
      hashedCanonicalRequest,
    ].join('\n')

    const expectedSignature = deriveSignature(
      {
        dateStamp: '20240105',
        region: 'us-east-1',
        service: 'iam',
      },
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      stringToSign,
    )

    expect(signature).toBe(expectedSignature)
  })

  it('includes the session token and sorts existing query params', async () => {
    const signedUrl = await signUrlWithSigV4({
      url: 'https://service.aws.example.com/resource?b=two&a=one',
      region: 'us-west-2',
      service: 'execute-api',
      credentials: {
        accessKeyId: 'ASIASESSION',
        secretAccessKey: 'secret',
        sessionToken: 'session-token-value',
      },
      expiresIn: 120,
      now: new Date('2024-07-10T09:00:00Z'),
    })

    const parsed = new URL(signedUrl)
    const params = Array.from(parsed.searchParams.entries())

    const securityToken = parsed.searchParams.get('X-Amz-Security-Token')
    expect(securityToken).toBe('session-token-value')

    const keysInOrder = params.map(([key]) => key)
    expect(keysInOrder).toEqual([
      'X-Amz-Algorithm',
      'X-Amz-Credential',
      'X-Amz-Date',
      'X-Amz-Expires',
      'X-Amz-Security-Token',
      'X-Amz-SignedHeaders',
      'a',
      'b',
      'X-Amz-Signature',
    ])
  })

  it('rejects expirations greater than one week', async () => {
    await expect(
      signUrlWithSigV4({
        url: 'https://example.com/',
        region: 'us-east-1',
        service: 'iam',
        credentials: {
          accessKeyId: 'AKID',
          secretAccessKey: 'SECRET',
        },
        expiresIn: 605000,
      }),
    ).rejects.toThrow(/604800/)
  })
})
