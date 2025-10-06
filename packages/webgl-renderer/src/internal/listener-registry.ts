export type Listener<TEvent> = (event: TEvent) => void

export interface ListenerRegistry<TEvent> {
  add(listener: Listener<TEvent>): () => void
  emit(event: TEvent): void
  clear(): void
  get size(): number
}

export const createListenerRegistry = <TEvent>(): ListenerRegistry<TEvent> => {
  const listeners = new Set<Listener<TEvent>>()

  return {
    add(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const listener of listeners) {
        listener(event)
      }
    },
    clear() {
      listeners.clear()
    },
    get size() {
      return listeners.size
    },
  }
}
