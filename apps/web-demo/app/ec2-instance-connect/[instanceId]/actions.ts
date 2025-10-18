'use server'

import {
  createInstanceConnectPresignedUrl,
  type InstanceConnectPresignResult,
} from '@/lib/instance-connect-presign'

export interface GenerateInstanceConnectUrlInput {
  readonly instanceId: string
  readonly region?: string
  readonly addressFamily?: 'ipv4' | 'ipv6'
  readonly port?: number
}

export async function generateInstanceConnectUrlAction(
  input: GenerateInstanceConnectUrlInput,
): Promise<InstanceConnectPresignResult> {
  return createInstanceConnectPresignedUrl({
    instanceId: input.instanceId,
    region: input.region,
    addressFamily: input.addressFamily,
    port: input.port,
  })
}
