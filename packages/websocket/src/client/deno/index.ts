/**
 * Placeholder for the future Deno client runtime.
 * Intentionally throws so downstream consumers avoid depending on the surface ahead of its implementation.
 */
export const createDenoWebSocketClient = (): never => {
  throw new Error('Nimbus WebSocket client for Deno is not implemented yet.')
}

