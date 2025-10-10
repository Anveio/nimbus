interface RemoteSignerDefaults {
  readonly endpoint?: string
  readonly region?: string
  readonly service?: string
  readonly maxExpires?: number
  readonly defaultExpires?: number
}

export interface RemoteSignerConfig {
  readonly endpoint: string
  readonly bearerToken: string
  readonly defaults: RemoteSignerDefaults
}

export interface SignRequestOptions {
  readonly endpoint: string
  readonly region: string
  readonly service: string
  readonly expiresIn: number
}

export interface SignResponse {
  readonly signedUrl: string
  readonly expiresAt: string
  readonly defaults: RemoteSignerDefaults
}

function loadFromEnv(): RemoteSignerConfig | null {
  const endpoint = import.meta.env.VITE_MANA_SIGNER_ENDPOINT?.trim()
  const bearerToken = import.meta.env.VITE_MANA_SIGNER_TOKEN?.trim()
  if (!endpoint || !bearerToken) {
    return null
  }
  const defaultEndpoint =
    import.meta.env.VITE_MANA_SIGNER_DEFAULT_ENDPOINT?.trim() || undefined
  const defaultRegion =
    import.meta.env.VITE_MANA_SIGNER_DEFAULT_REGION?.trim() || undefined
  const defaultService =
    import.meta.env.VITE_MANA_SIGNER_DEFAULT_SERVICE?.trim() || undefined
  const maxExpiresRaw = import.meta.env.VITE_MANA_SIGNER_MAX_EXPIRES?.trim()
  const defaultExpiresRaw =
    import.meta.env.VITE_MANA_SIGNER_DEFAULT_EXPIRES?.trim()

  const maxExpires =
    maxExpiresRaw && maxExpiresRaw.length > 0
      ? Number.parseInt(maxExpiresRaw, 10)
      : undefined
  const defaultExpires =
    defaultExpiresRaw && defaultExpiresRaw.length > 0
      ? Number.parseInt(defaultExpiresRaw, 10)
      : undefined

  const defaults: RemoteSignerDefaults = {
    ...(defaultEndpoint ? { endpoint: defaultEndpoint } : {}),
    ...(defaultRegion ? { region: defaultRegion } : {}),
    ...(defaultService ? { service: defaultService } : {}),
    ...(Number.isFinite(maxExpires) ? { maxExpires } : {}),
    ...(Number.isFinite(defaultExpires) ? { defaultExpires } : {}),
  }
  return {
    endpoint,
    bearerToken,
    defaults,
  }
}

const cachedConfig = loadFromEnv()

export function getRemoteSignerConfig(): RemoteSignerConfig | null {
  return cachedConfig
}

export async function requestRemoteSignedUrl(
  options: SignRequestOptions,
): Promise<SignResponse> {
  if (!cachedConfig) {
    throw new Error('Remote signer configuration is not available')
  }

  const response = await fetch(cachedConfig.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cachedConfig.bearerToken}`,
    },
    body: JSON.stringify({
      endpoint: options.endpoint,
      region: options.region,
      service: options.service,
      expiresIn: options.expiresIn,
    }),
  })

  if (!response.ok) {
    let detail: unknown
    try {
      detail = await response.json()
    } catch {
      detail = await response.text()
    }
    throw new Error(
      `Remote signer returned ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
    )
  }

  const payload = (await response.json()) as SignResponse
  if (!payload || typeof payload.signedUrl !== 'string') {
    throw new Error('Remote signer response malformed')
  }
  return payload
}
