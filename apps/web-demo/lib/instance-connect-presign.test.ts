import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  vi.resetModules()
})

describe('createInstanceConnectPresignedUrl', () => {
  it('generates a websocket URL that matches the SigV4 reference', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE'
    process.env.AWS_SECRET_ACCESS_KEY =
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
    process.env.AWS_SESSION_TOKEN =
      'AQoDYXdzEPT//////////wEXAMPLEtc764dLU0xTkxrUiYqDKAopZ6rgTYXpXyjwzW//EXAMPLE='
    process.env.NIMBUS_SIGNER_DEFAULT_ENDPOINT =
      'wss://example.amazonaws.com/proxy/instance-connect'
    process.env.NIMBUS_SIGNER_DEFAULT_REGION = 'us-east-1'
    process.env.NIMBUS_SIGNER_DEFAULT_SERVICE = 'ec2-instance-connect'
    process.env.NIMBUS_SIGNER_DEFAULT_EXPIRES = '60'
    process.env.NIMBUS_SIGNER_MAX_EXPIRES = '300'

    const { createInstanceConnectPresignedUrl } = await import(
      './instance-connect-presign'
    )

    const { url } = await createInstanceConnectPresignedUrl({
      instanceId: 'i-1234567890abcdef0',
      port: 22,
      addressFamily: 'ipv4',
      expiresIn: 60,
      timestamp: Date.UTC(2024, 0, 15, 12, 34, 56),
    })

    expect(url).toBe(
      'wss://example.amazonaws.com/proxy/instance-connect?addressFamily=ipv4&instanceId=i-1234567890abcdef0&port=22&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20240115%2Fus-east-1%2Fec2-instance-connect%2Faws4_request&X-Amz-Date=20240115T123456Z&X-Amz-Expires=60&X-Amz-Security-Token=AQoDYXdzEPT%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEXAMPLEtc764dLU0xTkxrUiYqDKAopZ6rgTYXpXyjwzW%2F%2FEXAMPLE%3D&X-Amz-SignedHeaders=host&X-Amz-Signature=b1453fc099cac72a337396a336948de0cb9d314033daba1b3c9d4e35748d63d7',
    )
  })
})
