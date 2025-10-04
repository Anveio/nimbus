export type Listener<T extends readonly unknown[]> = (...args: T) => void

export type EventMap = Record<string, readonly unknown[]>

export interface EventBus<Events extends EventMap> {
  on<K extends keyof Events>(
    event: K,
    listener: Listener<Events[K]>,
  ): () => void
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void
}

export function createEventBus<Events extends EventMap>(): EventBus<Events> {
  const listeners = new Map<keyof Events, Set<Listener<Events[keyof Events]>>>()

  return {
    on(event, listener) {
      let bucket = listeners.get(event)
      if (!bucket) {
        bucket = new Set()
        listeners.set(event, bucket)
      }
      ;(bucket as Set<Listener<Events[typeof event]>>).add(listener)
      return () => {
        const current = listeners.get(event) as
          | Set<Listener<Events[typeof event]>>
          | undefined
        current?.delete(listener)
        if (current && current.size === 0) {
          listeners.delete(event)
        }
      }
    },
    emit(event, ...args) {
      const bucket = listeners.get(event) as
        | Set<Listener<Events[typeof event]>>
        | undefined
      if (!bucket) return
      for (const listener of bucket) {
        listener(...args)
      }
    },
  }
}
