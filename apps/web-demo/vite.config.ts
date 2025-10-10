import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

interface CachedSignerConfig {
  readonly endpoint: string
  readonly discoveryEndpoint?: string | null
  readonly bearerToken: string
  readonly defaults?: {
    readonly endpoint?: string
    readonly region?: string
    readonly service?: string
    readonly maxExpires?: number
    readonly defaultExpires?: number
  }
}

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(new URL(import.meta.url))),
  '..',
  '..',
)

function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(workspaceRoot, ...segments)
}

function loadSignerConfig(): CachedSignerConfig | null {
  const signerConfigPath = resolveWorkspacePath('.mana', 'web-demo', 'signer.json')
  if (!fs.existsSync(signerConfigPath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(signerConfigPath, 'utf8')
    const parsed = JSON.parse(raw) as CachedSignerConfig | null
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (
      typeof parsed.endpoint !== 'string' ||
      parsed.endpoint.length === 0 ||
      typeof parsed.bearerToken !== 'string' ||
      parsed.bearerToken.length === 0
    ) {
      return null
    }
    let discoveryEndpoint = parsed.discoveryEndpoint ?? null
    if (!discoveryEndpoint && parsed.endpoint) {
      try {
        const endpointUrl = new URL(parsed.endpoint)
        const pathSegments = endpointUrl.pathname.split('/').filter(Boolean)
        if (pathSegments.length > 0) {
          pathSegments[pathSegments.length - 1] = 'discovery'
        } else {
          pathSegments.push('discovery')
        }
        endpointUrl.pathname = `/${pathSegments.join('/')}`
        discoveryEndpoint = endpointUrl.toString()
      } catch {
        // ignore malformed endpoint; caller will fall back to explicit value or disable discovery
        discoveryEndpoint = null
      }
    }
    return {
      ...parsed,
      discoveryEndpoint,
    }
  } catch (error) {
    console.warn(
      `[vite.config] Failed to read signer config: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

const signerConfig = loadSignerConfig()
const signerDefaults = signerConfig?.defaults ?? {}
const discoveryEndpoint =
  typeof signerConfig?.discoveryEndpoint === 'string' &&
  signerConfig.discoveryEndpoint.length > 0
    ? signerConfig.discoveryEndpoint
    : ''

// https://vite.dev/config/
export default defineConfig({
  plugins: [react({ include: /\.(js|jsx|ts|tsx)$/ })],
  resolve: {
    alias: {
      '@mana/ssh': resolveWorkspacePath('packages/ssh/src'),
      '@mana/websocket': resolveWorkspacePath('packages/websocket/src'),
    },
  },
  define: {
    'import.meta.env.VITE_MANA_SIGNER_ENDPOINT': JSON.stringify(
      signerConfig?.endpoint ?? '',
    ),
    'import.meta.env.VITE_MANA_SIGNER_TOKEN': JSON.stringify(
      signerConfig?.bearerToken ?? '',
    ),
    'import.meta.env.VITE_MANA_DISCOVERY_ENDPOINT': JSON.stringify(
      discoveryEndpoint,
    ),
    'import.meta.env.VITE_MANA_SIGNER_DEFAULT_ENDPOINT': JSON.stringify(
      signerDefaults.endpoint ?? '',
    ),
    'import.meta.env.VITE_MANA_SIGNER_DEFAULT_REGION': JSON.stringify(
      signerDefaults.region ?? '',
    ),
    'import.meta.env.VITE_MANA_SIGNER_DEFAULT_SERVICE': JSON.stringify(
      signerDefaults.service ?? '',
    ),
    'import.meta.env.VITE_MANA_SIGNER_MAX_EXPIRES': JSON.stringify(
      signerDefaults.maxExpires ?? '',
    ),
    'import.meta.env.VITE_MANA_SIGNER_DEFAULT_EXPIRES': JSON.stringify(
      signerDefaults.defaultExpires ?? '',
    ),
  },
})
