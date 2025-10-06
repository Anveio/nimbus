type FrameCallback = (timestamp: number) => void

type RafHandle = number & { readonly __brand: unique symbol }

type SchedulingHandle = { cancel(): void }

const createFallbackScheduler = (): ((
  callback: FrameCallback,
) => SchedulingHandle) => {
  return (callback) => {
    const id = setTimeout(() => {
      callback(performance.now())
    }, 0)
    return {
      cancel: () => clearTimeout(id),
    }
  }
}

const createRafScheduler = (): ((
  callback: FrameCallback,
) => SchedulingHandle) => {
  if (
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    return createFallbackScheduler()
  }
  return (callback) => {
    const handle = window.requestAnimationFrame((timestamp) => {
      callback(timestamp)
    }) as RafHandle
    return {
      cancel: () => window.cancelAnimationFrame(handle),
    }
  }
}

export class FrameScheduler {
  private readonly scheduleFrame = createRafScheduler()
  private pendingHandle: SchedulingHandle | null = null
  private pendingCallback: FrameCallback | null = null

  request(callback: FrameCallback): void {
    this.pendingCallback = callback
    if (this.pendingHandle) {
      return
    }
    this.pendingHandle = this.scheduleFrame((timestamp) => {
      this.pendingHandle = null
      const cb = this.pendingCallback
      this.pendingCallback = null
      if (cb) {
        cb(timestamp)
      }
    })
  }

  cancel(): void {
    if (this.pendingHandle) {
      this.pendingHandle.cancel()
      this.pendingHandle = null
      this.pendingCallback = null
    }
  }
}
