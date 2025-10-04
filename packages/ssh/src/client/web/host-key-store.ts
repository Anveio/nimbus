import type { HostKeyCandidate, HostKeyDecision, HostKeyStore } from '../../api'

export interface IndexedDbHostKeyStoreOptions {
  readonly databaseName?: string
  readonly storeName?: string
  readonly trustOnFirstUse?: boolean
  readonly indexedDB?: IDBFactory
}

type StoredHostKey = {
  readonly host: string
  readonly port: number
  readonly keyType: string
  readonly raw: Uint8Array
  readonly fingerprint: string
}

const DEFAULT_DATABASE_NAME = 'mana-ssh-host-keys'
const DEFAULT_STORE_NAME = 'host-keys'

export async function createIndexedDbHostKeyStore(
  options: IndexedDbHostKeyStoreOptions = {},
): Promise<HostKeyStore> {
  const factory = options.indexedDB ?? globalThis.indexedDB
  if (!factory) {
    throw new Error(
      'IndexedDB is not available in this environment. Set hostKeyPersistence to "memory" or provide a custom HostKeyStore.',
    )
  }

  const db = await openDatabase({
    factory,
    databaseName: options.databaseName ?? DEFAULT_DATABASE_NAME,
    storeName: options.storeName ?? DEFAULT_STORE_NAME,
  })

  const trustOnFirstUse = options.trustOnFirstUse ?? true

  return {
    async evaluate(candidate) {
      const key = canonicalKey(candidate)
      const stored = await getRecord(db, key)
      if (!stored) {
        if (trustOnFirstUse) {
          await putRecord(db, key, toStored(candidate))
          return { outcome: 'trusted', source: 'pinned' as const }
        }
        return { outcome: 'unknown' }
      }

      if (equalBytes(stored.raw, candidate.raw)) {
        return { outcome: 'trusted', source: 'known-hosts' as const }
      }

      return {
        outcome: 'mismatch',
        severity: 'fatal',
        comment: 'Stored host key does not match candidate',
      }
    },
    async remember(candidate, decision) {
      if (decision.outcome === 'trusted') {
        const key = canonicalKey(candidate)
        await putRecord(db, key, toStored(candidate))
      }
    },
  }
}

async function openDatabase(params: {
  factory: IDBFactory
  databaseName: string
  storeName: string
}): Promise<IDBPDatabase> {
  const { factory, databaseName, storeName } = params
  const request = factory.open(databaseName, 1)

  return new Promise((resolve, reject) => {
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName)
      }
    }
    request.onsuccess = () => {
      resolve({ db: request.result, storeName })
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB open request failed'))
    }
  })
}

type IDBPDatabase = { db: IDBDatabase; storeName: string }

async function getRecord(
  database: IDBPDatabase,
  key: string,
): Promise<StoredHostKey | null> {
  const transaction = database.db.transaction(database.storeName, 'readonly')
  const store = transaction.objectStore(database.storeName)
  const request = store.get(key)
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const value = request.result
      if (!value) {
        resolve(null)
        return
      }
      resolve(fromStored(value))
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB read failed'))
    }
  })
}

async function putRecord(
  database: IDBPDatabase,
  key: string,
  value: StoredHostKey,
): Promise<void> {
  const transaction = database.db.transaction(database.storeName, 'readwrite')
  const store = transaction.objectStore(database.storeName)
  const request = store.put(toPersisted(value), key)
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB write failed'))
  })
}

function canonicalKey(candidate: HostKeyCandidate): string {
  return `${candidate.host}:${candidate.port}:${candidate.keyType}`
}

function toStored(candidate: HostKeyCandidate): StoredHostKey {
  return {
    host: candidate.host,
    port: candidate.port,
    keyType: candidate.keyType,
    raw: new Uint8Array(candidate.raw),
    fingerprint: candidate.fingerprint,
  }
}

function toPersisted(value: StoredHostKey): PersistedHostKey {
  const copy = value.raw.slice()
  return {
    host: value.host,
    port: value.port,
    keyType: value.keyType,
    raw: copy.buffer,
    fingerprint: value.fingerprint,
  }
}

function fromStored(value: unknown): StoredHostKey {
  const record = value as PersistedHostKey
  return {
    host: record.host,
    port: record.port,
    keyType: record.keyType,
    raw: new Uint8Array(record.raw),
    fingerprint: record.fingerprint,
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

type PersistedHostKey = {
  readonly host: string
  readonly port: number
  readonly keyType: string
  readonly raw: ArrayBuffer
  readonly fingerprint: string
}
