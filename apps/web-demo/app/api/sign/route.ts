import { NextResponse, type NextRequest } from 'next/server'
import {
  createInstanceConnectPresignedUrl,
  type InstanceConnectPresignParams,
} from '@/lib/instance-connect-presign'

type SignRequestPayload = {
  readonly endpoint?: string
  readonly region?: string
  readonly service?: string
  readonly expiresIn?: number
  readonly instanceId?: string
  readonly addressFamily?: 'ipv4' | 'ipv6'
  readonly port?: number
}

interface SignerConfig {
  readonly bearerToken?: string
}

const config: SignerConfig = {
  bearerToken:
    process.env.NIMBUS_SIGNER_TOKEN ?? process.env.SIGNER_TOKEN ?? undefined,
}

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
    if (!payload.instanceId) {
      return jsonResponse(400, {
        error: 'bad_request',
        message: 'instanceId is required to sign the request.',
      })
    }

    const params: InstanceConnectPresignParams = {
      instanceId: payload.instanceId,
      endpoint: payload.endpoint,
      region: payload.region,
      service: payload.service,
      expiresIn: payload.expiresIn,
      addressFamily: payload.addressFamily,
      port: payload.port,
    }

    const { url, expiresIn, region, service } =
      await createInstanceConnectPresignedUrl(params)

    return jsonResponse(200, {
      url,
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
