import type { HostKeyCandidate, HostKeyStore } from '../../api'

export interface MemoryHostKeyStoreOptions {
  readonly trustOnFirstUse?: boolean
}

export function createMemoryHostKeyStore(
  options: MemoryHostKeyStoreOptions = {},
): HostKeyStore {
  const seen = new Map<string, HostKeyCandidate>()
  const trustOnFirstUse = options.trustOnFirstUse ?? true
  return {
    async evaluate(candidate) {
      const key = canonicalHostKeyId(candidate)
      const existing = seen.get(key)
      if (!existing) {
        if (trustOnFirstUse) {
          seen.set(key, candidate)
          return { outcome: 'trusted', source: 'pinned' }
        }
        return { outcome: 'unknown' }
      }
      if (equalBytes(existing.raw, candidate.raw)) {
        return { outcome: 'trusted', source: 'known-hosts' }
      }
      return {
        outcome: 'mismatch',
        severity: 'fatal',
        comment: 'Stored host key does not match candidate',
      }
    },
    async remember(candidate, decision) {
      if (decision.outcome === 'trusted') {
        seen.set(canonicalHostKeyId(candidate), candidate)
      }
    },
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    diff |= left ^ right
  }
  return diff === 0
}

function canonicalHostKeyId(candidate: HostKeyCandidate): string {
  return `${candidate.host}:${candidate.port}:${candidate.keyType}`
}
