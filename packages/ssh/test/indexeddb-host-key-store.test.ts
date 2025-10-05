import 'fake-indexeddb/auto'

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { createIndexedDbHostKeyStore } from '../src/client/web/host-key-store'
import type { HostKeyCandidate } from '../src/api'

function createCandidate(
  overrides: Partial<HostKeyCandidate> = {},
): HostKeyCandidate {
  return {
    host: 'example.test',
    port: 22,
    keyType: 'ssh-ed25519',
    fingerprint: 'abc123',
    raw: new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  }
}

describe('createIndexedDbHostKeyStore', () => {
  it('trusts new hosts on first use and persists them', async () => {
    const store = await createIndexedDbHostKeyStore({
      databaseName: `test-db-${randomUUID()}`,
    })
    const candidate = createCandidate()

    const first = await store.evaluate(candidate)
    expect(first).toEqual({ outcome: 'trusted', source: 'pinned' })

    const second = await store.evaluate(candidate)
    expect(second).toEqual({ outcome: 'trusted', source: 'known-hosts' })
  })

  it('detects mismatched keys for the same host entry', async () => {
    const databaseName = `test-db-${randomUUID()}`
    const store = await createIndexedDbHostKeyStore({ databaseName })
    const original = createCandidate({ raw: new Uint8Array([5, 6, 7, 8]) })

    await store.evaluate(original)

    const mismatch = await store.evaluate(
      createCandidate({ raw: new Uint8Array([9, 10, 11, 12]) }),
    )

    expect(mismatch).toEqual({
      outcome: 'mismatch',
      severity: 'fatal',
      comment: 'Stored host key does not match candidate',
    })
  })

  it('supports explicit remember calls when TOFU is disabled', async () => {
    const databaseName = `test-db-${randomUUID()}`
    const store = await createIndexedDbHostKeyStore({
      databaseName,
      trustOnFirstUse: false,
    })
    const candidate = createCandidate({ raw: new Uint8Array([42, 43, 44]) })

    const initial = await store.evaluate(candidate)
    expect(initial).toEqual({ outcome: 'unknown' })

    if (store.remember) {
      await store.remember(candidate, { outcome: 'trusted', source: 'pinned' })
    }

    const subsequent = await store.evaluate(candidate)
    expect(subsequent).toEqual({ outcome: 'trusted', source: 'known-hosts' })
  })
})
