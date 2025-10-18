import { describe, expect, it } from 'vitest'
import { createAwsPresignedUrl } from './aws-presign'

describe('createAwsPresignedUrl', () => {
  it('matches the AWS SigV4 reference signature for EC2 Instance Connect', async () => {
    const url = await createAwsPresignedUrl({
      method: 'GET',
      host: 'example.amazonaws.com',
      path: '/proxy/instance-connect',
      service: 'ec2-instance-connect',
      payload: '',
      key: 'AKIDEXAMPLE',
      secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      sessionToken:
        'AQoDYXdzEPT//////////wEXAMPLEtc764dLU0xTkxrUiYqDKAopZ6rgTYXpXyjwzW//EXAMPLE=',
      protocol: 'wss',
      timestamp: Date.UTC(2024, 0, 15, 12, 34, 56),
      region: 'us-east-1',
      expires: 60,
      query: {
        instanceId: 'i-1234567890abcdef0',
        port: 22,
        addressFamily: 'ipv4',
      },
      headers: {
        Host: 'example.amazonaws.com',
      },
    })

    expect(url).toBe(
      'wss://example.amazonaws.com/proxy/instance-connect?addressFamily=ipv4&instanceId=i-1234567890abcdef0&port=22&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20240115%2Fus-east-1%2Fec2-instance-connect%2Faws4_request&X-Amz-Date=20240115T123456Z&X-Amz-Expires=60&X-Amz-Security-Token=AQoDYXdzEPT%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEXAMPLEtc764dLU0xTkxrUiYqDKAopZ6rgTYXpXyjwzW%2F%2FEXAMPLE%3D&X-Amz-SignedHeaders=host&X-Amz-Signature=b1453fc099cac72a337396a336948de0cb9d314033daba1b3c9d4e35748d63d7',
    )
  })

  it('hashes provided payloads when presigning', async () => {
    const url = await createAwsPresignedUrl({
      method: 'POST',
      host: 'service.amazonaws.com',
      path: '/action',
      service: 'execute-api',
      payload: 'Action=DescribeInstances&Version=2016-11-15',
      key: 'AKIDEXAMPLE',
      secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      protocol: 'https',
      timestamp: Date.UTC(2024, 5, 1, 0, 0, 0),
      region: 'us-west-2',
      expires: 900,
      query: {
        version: '2016-11-15',
      },
      headers: {
        Host: 'service.amazonaws.com',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
    })

    expect(url).toBe(
      'https://service.amazonaws.com/action?version=2016-11-15&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20240601%2Fus-west-2%2Fexecute-api%2Faws4_request&X-Amz-Date=20240601T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=e598c27d5725a3a8fe46eb18509e1f8f7b68b42fb1d6263c1fce874e3accb99f',
    )
  })
})
