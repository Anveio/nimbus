export interface DiscoveryResult {
  readonly region: string
  readonly instances: Array<{
    readonly instanceId: string
    readonly state?: string
    readonly availabilityZone?: string
    readonly publicDnsName?: string
    readonly publicIpAddress?: string
    readonly privateIpAddress?: string
    readonly name?: string
    readonly vpcId?: string
    readonly subnetId?: string
    readonly tags: Record<string, string>
  }>
  readonly instanceConnectEndpoints: Array<{
    readonly endpointId: string
    readonly state?: string
    readonly statusReason?: string
    readonly createdAt?: string
    readonly dnsName?: string
    readonly vpcId?: string
    readonly subnetId?: string
    readonly securityGroupIds?: readonly string[]
  }>
  readonly vpcs: Array<{
    readonly vpcId: string
    readonly cidrBlock?: string
    readonly state?: string
    readonly ownerId?: string
    readonly tags: Record<string, string>
  }>
}

function resolveDiscoveryEndpoint(): string {
  const endpoint =
    import.meta.env.VITE_NIMBUS_DISCOVERY_ENDPOINT ??
    import.meta.env.VITE_MANA_DISCOVERY_ENDPOINT
  if (typeof endpoint === 'string' && endpoint.trim().length > 0) {
    return endpoint.trim()
  }
  throw new Error(
    'Discovery endpoint not configured. Redeploy the dev infra to generate the endpoint.',
  )
}

function resolveBearerToken(): string {
  const token =
    import.meta.env.VITE_NIMBUS_SIGNER_TOKEN ??
    import.meta.env.VITE_MANA_SIGNER_TOKEN
  if (typeof token === 'string' && token.trim().length > 0) {
    return token.trim()
  }
  throw new Error(
    'Signer token not configured. Redeploy the dev infra to generate credentials.',
  )
}

export async function fetchDiscoveryMetadata(
  region?: string,
): Promise<DiscoveryResult> {
  const endpoint = resolveDiscoveryEndpoint()
  const token = resolveBearerToken()

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ region }),
  })

  if (!response.ok) {
    let detail: unknown
    try {
      detail = await response.json()
    } catch {
      detail = await response.text()
    }
    throw new Error(
      `Discovery endpoint returned ${response.status}: ${
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      }`,
    )
  }

  return (await response.json()) as DiscoveryResult
}
