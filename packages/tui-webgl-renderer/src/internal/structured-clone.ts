export const structuredCloneSafe = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  if (value === undefined || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => structuredCloneSafe(item)) as unknown as T
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        structuredCloneSafe(item),
      ]),
    ) as T
  }

  return value
}
