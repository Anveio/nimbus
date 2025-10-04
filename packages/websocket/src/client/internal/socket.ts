export type MessageData = string | ArrayBuffer | ArrayBufferView | Blob

export interface RuntimeWebSocket {
  readonly readyState: number
  readonly protocol: string
  readonly bufferedAmount?: number
  send(data: MessageData): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'open',
    listener: (event: { readonly target: unknown }) => void,
  ): void
  addEventListener(
    type: 'message',
    listener: (event: { readonly data: MessageData }) => void,
  ): void
  addEventListener(
    type: 'close',
    listener: (event: {
      readonly code: number
      readonly reason: string
    }) => void,
  ): void
  addEventListener(
    type: 'error',
    listener: (event: { readonly error?: unknown }) => void,
  ): void
  removeEventListener(
    type: 'open',
    listener: (event: { readonly target: unknown }) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: { readonly data: MessageData }) => void,
  ): void
  removeEventListener(
    type: 'close',
    listener: (event: {
      readonly code: number
      readonly reason: string
    }) => void,
  ): void
  removeEventListener(
    type: 'error',
    listener: (event: { readonly error?: unknown }) => void,
  ): void
}

export interface WebSocketFactory {
  create(url: string, protocols?: string | string[]): RuntimeWebSocket
}

type UnderlyingWebSocket = {
  readyState: number
  protocol: string
  send(data: MessageData): void
  close(code?: number, reason?: string): void
  addEventListener?: (type: string, listener: (event: unknown) => void) => void
  removeEventListener?: (
    type: string,
    listener: (event: unknown) => void,
  ) => void
  on?: (type: string, listener: (event: unknown) => void) => void
  off?: (type: string, listener: (event: unknown) => void) => void
  onopen?: (event: unknown) => void
  onmessage?: (event: unknown) => void
  onclose?: (event: unknown) => void
  onerror?: (event: unknown) => void
}

type EventType = 'open' | 'message' | 'close' | 'error'

type Listener = (event: unknown) => void

export function adaptWebSocket(instance: unknown): RuntimeWebSocket {
  const ws = instance as UnderlyingWebSocket
  const target = ws as Record<string, unknown>

  const listenerBuckets: Record<EventType, Set<Listener>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }

  const emit = (type: EventType, event: unknown) => {
    for (const listener of listenerBuckets[type]) {
      listener(event)
    }
  }

  const attach = (type: EventType, handler: Listener) => {
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener(type, handler)
      return
    }
    if (typeof ws.on === 'function') {
      ws.on(type, handler)
      return
    }
    const prop = `on${type}`
    const existing =
      typeof target[prop] === 'function'
        ? (target[prop] as (event: unknown) => void)
        : undefined
    target[prop] = (event: unknown) => {
      existing?.(event)
      handler(event)
    }
  }

  const normalise = (type: EventType, event: unknown): unknown => {
    switch (type) {
      case 'open':
        return typeof event === 'object' && event !== null
          ? event
          : { target: ws }
      case 'message':
        if (
          typeof event === 'object' &&
          event !== null &&
          'data' in (event as Record<string, unknown>)
        ) {
          return event
        }
        return { data: event as MessageData }
      case 'close':
        if (
          typeof event === 'object' &&
          event !== null &&
          'code' in (event as Record<string, unknown>)
        ) {
          return event
        }
        return { code: 1000, reason: '' }
      case 'error':
        if (
          typeof event === 'object' &&
          event !== null &&
          'error' in (event as Record<string, unknown>)
        ) {
          return event
        }
        return { error: event }
      default:
        return event
    }
  }

  attach('open', (event) => emit('open', normalise('open', event)))
  attach('message', (event) => emit('message', normalise('message', event)))
  attach('close', (event) => emit('close', normalise('close', event)))
  attach('error', (event) => emit('error', normalise('error', event)))

  return {
    get readyState() {
      return ws.readyState
    },
    get protocol() {
      return ws.protocol
    },
    get bufferedAmount() {
      return (ws as { bufferedAmount?: number }).bufferedAmount
    },
    send(data) {
      ws.send(data)
    },
    close(code, reason) {
      ws.close(code, reason)
    },
    addEventListener(type, listener) {
      listenerBuckets[type].add(listener as Listener)
    },
    removeEventListener(type, listener) {
      listenerBuckets[type].delete(listener as Listener)
    },
  }
}

export function makeFactory(
  Implementation: new (url: string, protocols?: string | string[]) => unknown,
): WebSocketFactory {
  return {
    create(url, protocols) {
      const instance = new Implementation(url, protocols)
      return adaptWebSocket(instance)
    },
  }
}
