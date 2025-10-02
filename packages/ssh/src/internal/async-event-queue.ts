import { SshInvariantViolation } from '../errors'

interface PendingResolver<T> {
  resolve(value: IteratorResult<T>): void
}

/**
 * Minimal async iterable queue. Producers call `push`, consumers either await
 * `next()` or iterate via `for await`. Used to surface SSH events without
 * owning the transport lifecycle.
 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  #buffer: T[] = []
  #resolvers: PendingResolver<T>[] = []
  #closed = false

  push(value: T): void {
    if (this.#closed) {
      throw new SshInvariantViolation('Cannot push into a closed AsyncEventQueue')
    }
    const resolver = this.#resolvers.shift()
    if (resolver) {
      resolver.resolve({ value, done: false })
      return
    }
    this.#buffer.push(value)
  }

  next(): Promise<IteratorResult<T>> {
    if (this.#buffer.length > 0) {
      const value = this.#buffer.shift() as T
      return Promise.resolve({ value, done: false })
    }
    if (this.#closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.#resolvers.push({ resolve })
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const resolver of this.#resolvers.splice(0)) {
      resolver.resolve({ value: undefined, done: true })
    }
  }

  drain(): T[] {
    const drained = this.#buffer.splice(0)
    return drained
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    }
  }
}

