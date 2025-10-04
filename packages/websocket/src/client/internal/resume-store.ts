export interface ResumeRecord {
  readonly token: string
  readonly expiresAt: number
}

export interface ResumeStore {
  get(): ResumeRecord | undefined
  set(record: ResumeRecord): void
  clear(): void
}

export function createResumeStore(
  kind: 'memory' | 'session' | 'none',
  key: string,
): ResumeStore {
  if (kind === 'none') {
    return {
      get: () => undefined,
      set: () => {},
      clear: () => {},
    }
  }

  if (kind === 'memory') {
    let record: ResumeRecord | undefined
    return {
      get: () => record,
      set(next) {
        record = next
      },
      clear() {
        record = undefined
      },
    }
  }

  const storage = globalThis.sessionStorage
  if (!storage) {
    return createResumeStore('memory', key)
  }

  return {
    get() {
      const raw = storage.getItem(key)
      if (!raw) return undefined
      try {
        const parsed = JSON.parse(raw) as ResumeRecord
        if (
          typeof parsed.token !== 'string' ||
          typeof parsed.expiresAt !== 'number'
        ) {
          storage.removeItem(key)
          return undefined
        }
        if (Date.now() > parsed.expiresAt) {
          storage.removeItem(key)
          return undefined
        }
        return parsed
      } catch {
        storage.removeItem(key)
        return undefined
      }
    },
    set(next) {
      storage.setItem(key, JSON.stringify(next))
    },
    clear() {
      storage.removeItem(key)
    },
  }
}
