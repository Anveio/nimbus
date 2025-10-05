import { describe, expect, it } from 'vitest'

import type {
  HostKeyCandidate,
  HostKeyDecision,
  HostKeyStore,
} from '../src/api'

function createCandidate(
  overrides: Partial<HostKeyCandidate> = {},
): HostKeyCandidate {
  return {
    host: 'managed.example',
    port: 2222,
    keyType: 'ssh-ed25519',
    fingerprint: 'sha256:allowed',
    raw: new Uint8Array([9, 9, 9, 9]),
    ...overrides,
  }
}

describe('Custom HostKeyStore', () => {
  it('allows advanced users to wire their own trusted key list', async () => {
    class ListBackedHostKeyStore implements HostKeyStore {
      #trusted = new Map<string, { raw: Uint8Array; fingerprint: string }>()

      constructor(initial: ReadonlyArray<HostKeyCandidate>) {
        for (const candidate of initial) {
          this.#trusted.set(this.#key(candidate), {
            raw: new Uint8Array(candidate.raw),
            fingerprint: candidate.fingerprint,
          })
        }
      }

      async evaluate(candidate: HostKeyCandidate): Promise<HostKeyDecision> {
        const trusted = this.#trusted.get(this.#key(candidate))
        if (!trusted) {
          return { outcome: 'unknown' }
        }
        if (
          trusted.fingerprint === candidate.fingerprint &&
          this.#equalBytes(trusted.raw, candidate.raw)
        ) {
          return { outcome: 'trusted', source: 'pinned' }
        }
        return {
          outcome: 'mismatch',
          severity: 'fatal',
          comment: 'Managed host key list reported a mismatch',
        }
      }

      async remember(
        candidate: HostKeyCandidate,
        decision: HostKeyDecision,
      ): Promise<void> {
        if (decision.outcome === 'trusted') {
          this.#trusted.set(this.#key(candidate), {
            raw: new Uint8Array(candidate.raw),
            fingerprint: candidate.fingerprint,
          })
        }
      }

      #key(candidate: HostKeyCandidate): string {
        return `${candidate.host}:${candidate.port}:${candidate.keyType}`
      }

      #equalBytes(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) {
          return false
        }
        let diff = 0
        for (let i = 0; i < a.length; i += 1) {
          diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
        }
        return diff === 0
      }
    }

    const preTrusted = createCandidate()
    const store = new ListBackedHostKeyStore([preTrusted])

    const decision = await store.evaluate(createCandidate())
    expect(decision).toEqual({ outcome: 'trusted', source: 'pinned' })

    const unknown = await store.evaluate(
      createCandidate({
        fingerprint: 'sha256:other',
        raw: new Uint8Array([1, 2, 3]),
      }),
    )
    expect(unknown).toEqual({
      outcome: 'mismatch',
      severity: 'fatal',
      comment: 'Managed host key list reported a mismatch',
    })

    const newHost = createCandidate({
      host: 'new.example',
      fingerprint: 'sha256:new',
    })
    const firstDecision = await store.evaluate(newHost)
    expect(firstDecision).toEqual({ outcome: 'unknown' })

    await store.remember(newHost, { outcome: 'trusted', source: 'pinned' })

    const secondDecision = await store.evaluate(newHost)
    expect(secondDecision).toEqual({ outcome: 'trusted', source: 'pinned' })
  })
})
